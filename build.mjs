import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, posix as posixPath } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = 'src/absorb-main.js';
const OUTPUT_FILENAME = 'talmud-קליטת-תלמידים.user.js';

// ─── Module graph resolution ─────────────────────────────────────────────────

// Matches a full `import ... from '...'` statement, single- or multi-line.
const IMPORT_STATEMENT_RE = /^import\s+[\s\S]*?from\s+['"]([^'"]+)['"];?[ \t]*\r?\n?/gm;

function extractImportSpecifiers(source) {
  const specs = [];
  const re = new RegExp(IMPORT_STATEMENT_RE.source, 'gm');
  let m;
  while ((m = re.exec(source))) {
    specs.push(m[1]);
  }
  return specs;
}

/**
 * Resolve the dependency-ordered (depth-first post-order) list of repo-relative
 * module paths reachable from `entry`, given a `readFile(repoRelativePath) => string`
 * function. Throws a clear error on a missing file, an import cycle, or a
 * `node:*` / non-relative import (unsupported inside src/).
 */
export function resolveModuleOrder(entry, readFile) {
  const order = [];
  const visited = new Set();
  const visiting = [];

  function visit(path) {
    if (visited.has(path)) return;
    if (visiting.includes(path)) {
      const chain = [...visiting, path].join(' -> ');
      throw new Error(`Module import cycle detected: ${chain}`);
    }

    let source;
    try {
      source = readFile(path);
    } catch (err) {
      throw new Error(`Cannot read module "${path}" (imported via ${visiting.join(' -> ') || '<entry>'}): ${err.message}`);
    }
    if (typeof source !== 'string') {
      throw new Error(`Module not found: "${path}" (imported via ${visiting.join(' -> ') || '<entry>'})`);
    }

    visiting.push(path);
    for (const spec of extractImportSpecifiers(source)) {
      if (spec.startsWith('node:')) {
        throw new Error(`Unsupported Node core import "${spec}" in "${path}" — src/ modules must not import Node core modules.`);
      }
      if (!spec.startsWith('.')) {
        throw new Error(`Unsupported non-relative import "${spec}" in "${path}" — only relative './x.js' imports are supported.`);
      }
      const depPath = posixPath.normalize(posixPath.join(posixPath.dirname(path), spec));
      visit(depPath);
    }
    visiting.pop();

    visited.add(path);
    order.push(path);
  }

  visit(entry);
  return order;
}

// ─── Stripping import/export syntax ──────────────────────────────────────────

const EXPORT_DEFAULT_RE = /^export\s+default\b/m;
const EXPORT_LIST_RE = /^export\s*\{/m;
// Strips the `export ` keyword from supported top-level declaration forms only.
const EXPORT_DECL_RE = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;

/**
 * Strip ESM `import`/`export` syntax from a module's source so it can be
 * concatenated into a single shared-scope IIFE. Supports `export function`,
 * `export async function`, `export const/let/var`, and `export class`.
 * Throws (naming `path`) on `export default` or `export { ... }` lists, which
 * this bundler does not support.
 */
export function stripModuleSyntax(source, path) {
  if (EXPORT_DEFAULT_RE.test(source)) {
    throw new Error(`Unsupported "export default" in "${path}" — the bundler only supports named export function/const/let/var/class.`);
  }
  if (EXPORT_LIST_RE.test(source)) {
    throw new Error(`Unsupported "export { ... }" list in "${path}" — the bundler only supports named export function/const/let/var/class.`);
  }

  return source
    .replace(IMPORT_STATEMENT_RE, '')
    .replace(EXPORT_DECL_RE, '');
}

// ─── Duplicate top-level identifier detection ────────────────────────────────

const TOP_LEVEL_DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * Names declared at top level of `source` (line-based heuristic: declarations
 * start at column 0, which holds after `stripModuleSyntax`).
 */
export function findTopLevelDeclarations(source) {
  const names = [];
  const re = new RegExp(TOP_LEVEL_DECL_RE.source, 'gm');
  let m;
  while ((m = re.exec(source))) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Throws if the same top-level identifier is declared in more than one
 * module, naming the identifier and both offending files — a real hazard
 * once modules share one concatenated scope.
 */
export function assertNoDuplicateTopLevel(modulesWithSource) {
  const owner = new Map();
  for (const { path, source } of modulesWithSource) {
    for (const name of findTopLevelDeclarations(source)) {
      const existing = owner.get(name);
      if (existing && existing !== path) {
        throw new Error(`Duplicate top-level identifier "${name}" declared in both "${existing}" and "${path}" — they will collide in the concatenated userscript scope.`);
      }
      owner.set(name, path);
    }
  }
}

// ─── Userscript header ────────────────────────────────────────────────────────

/**
 * Build the `// ==UserScript==` header block from an ordered array of
 * [key, value] pairs (so a later task can splice in `@require` etc. with one
 * entry). Keys are padded to align, mirroring the legacy header's style.
 */
export function buildHeader(pkg, opts = {}) {
  const runAt = opts.runAt || 'document-idle';
  const rawBase = 'https://github.com/mdj441/talmud-scripts/raw/refs/heads/main/dist/';
  const updateUrl = rawBase + encodeURIComponent(OUTPUT_FILENAME);

  const entries = [
    ['@name', 'תלמוד - קליטת תלמידים'],
    ['@namespace', 'https://github.com/mdj441/talmud-scripts'],
    ['@version', pkg.version],
    ['@description', 'קליטת תלמידים באצווה לתלמו"ד — v3.3 מודולרי'],
    ['@author', 'מרדכי יאקאב'],
    ['@match', 'https://talmud.edu.gov.il/*'],
    ['@grant', 'none'],
    ['@run-at', runAt],
    ['@updateURL', updateUrl],
    ['@downloadURL', updateUrl],
    ['@supportURL', 'https://github.com/mdj441/talmud-scripts/issues'],
  ];

  const keyWidth = Math.max(...entries.map(([key]) => key.length)) + 2;
  const lines = entries.map(([key, value]) => `// ${key.padEnd(keyWidth)}${value}`);
  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
}

// ─── Full userscript assembly ─────────────────────────────────────────────────

/**
 * Build the complete userscript source: header + IIFE-wrapped, dependency-
 * ordered, import/export-stripped modules starting at `entry`. Deterministic:
 * byte-identical across runs given identical inputs.
 */
export function buildUserscript({ pkg, entry, readFile }) {
  const order = resolveModuleOrder(entry, readFile);

  const modulesWithSource = order.map((path) => ({
    path,
    source: stripModuleSyntax(readFile(path), path),
  }));

  assertNoDuplicateTopLevel(modulesWithSource);

  const header = buildHeader(pkg);
  const body = modulesWithSource
    .map(({ path, source }) => `// ─── ${path} ───\n${source}`)
    .join('\n');

  return `${header}\n\n(function () {\n  'use strict';\n\n${body}\n})();\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function runCli() {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
    const readFile = (repoRelativePath) => readFileSync(join(__dirname, repoRelativePath), 'utf8');

    const output = buildUserscript({ pkg, entry: ENTRY, readFile });

    // Syntax-check the generated userscript before writing it out.
    new vm.Script(output, { filename: OUTPUT_FILENAME });

    const distDir = join(__dirname, 'dist');
    mkdirSync(distDir, { recursive: true });
    const outPath = join(distDir, OUTPUT_FILENAME);
    writeFileSync(outPath, output, 'utf8');

    console.log(`Built ${outPath} (v${pkg.version})`);
  } catch (err) {
    console.error(`Build failed: ${err.message}`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCli();
}
