import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  stripModuleSyntax,
  resolveModuleOrder,
  findTopLevelDeclarations,
  assertNoDuplicateTopLevel,
  buildHeader,
  buildUserscript,
} from '../build.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const DIST_PATH = join(rootDir, 'dist', 'talmud-קליטת-תלמידים.user.js');

function fsReadFile(repoRelativePath) {
  return readFileSync(join(rootDir, repoRelativePath), 'utf8');
}

// ─── stripModuleSyntax: imports ──────────────────────────────────────────────
test('stripModuleSyntax: מסיר import חד-שורתי', () => {
  const src = "import { $el } from './core/dom.js';\nconst x = 1;\n";
  const out = stripModuleSyntax(src, 'src/x.js');
  assert.ok(!out.includes('import'));
  assert.ok(out.includes('const x = 1;'));
});

test('stripModuleSyntax: מסיר import רב-שורתי', () => {
  const src = [
    "import {",
    "  a,",
    "  b,",
    "} from './core/dom.js';",
    'const y = a + b;',
    '',
  ].join('\n');
  const out = stripModuleSyntax(src, 'src/x.js');
  assert.ok(!out.includes('import'));
  assert.ok(out.includes('const y = a + b;'));
});

test('stripModuleSyntax: מסיר כמה imports (חד-שורתי + רב-שורתי) מאותו קובץ', () => {
  const src = [
    "import { a } from './a.js';",
    "import {",
    "  b,",
    "  c,",
    "} from './bc.js';",
    'const z = a + b + c;',
    '',
  ].join('\n');
  const out = stripModuleSyntax(src, 'src/x.js');
  assert.ok(!/^import /m.test(out));
  assert.ok(out.includes('const z = a + b + c;'));
});

// ─── stripModuleSyntax: exports ──────────────────────────────────────────────
test('stripModuleSyntax: מסיר "export " מ-export function', () => {
  const out = stripModuleSyntax('export function foo() {\n  return 1;\n}\n', 'src/x.js');
  assert.ok(out.startsWith('function foo()'));
  assert.ok(!/^export /m.test(out));
});

test('stripModuleSyntax: מסיר "export " מ-export async function', () => {
  const out = stripModuleSyntax('export async function foo() {\n  return 1;\n}\n', 'src/x.js');
  assert.ok(out.startsWith('async function foo()'));
  assert.ok(!/^export /m.test(out));
});

test('stripModuleSyntax: מסיר "export " מ-export const', () => {
  const out = stripModuleSyntax("export const X = 1;\n", 'src/x.js');
  assert.ok(out.startsWith('const X = 1;'));
  assert.ok(!/^export /m.test(out));
});

test('stripModuleSyntax: מסיר "export " מ-export let / export var / export class', () => {
  assert.ok(stripModuleSyntax('export let a = 1;\n', 'src/x.js').startsWith('let a = 1;'));
  assert.ok(stripModuleSyntax('export var a = 1;\n', 'src/x.js').startsWith('var a = 1;'));
  assert.ok(stripModuleSyntax('export class Foo {}\n', 'src/x.js').startsWith('class Foo {}'));
});

test('stripModuleSyntax: זורק על export default', () => {
  assert.throws(
    () => stripModuleSyntax('export default function foo() {}\n', 'src/bad.js'),
    /src\/bad\.js/
  );
});

test('stripModuleSyntax: זורק על export { ... } (רשימת יצוא)', () => {
  assert.throws(
    () => stripModuleSyntax("const a = 1;\nexport { a };\n", 'src/bad2.js'),
    /src\/bad2\.js/
  );
});

// ─── resolveModuleOrder ───────────────────────────────────────────────────────
test('resolveModuleOrder: תלות לפני התלוי בה (גרף מדומה)', () => {
  const graph = {
    'src/a.js': "import { b } from './b.js';\nconst a = b;\n",
    'src/b.js': "import { c } from './c.js';\nconst b = c;\n",
    'src/c.js': 'const c = 1;\n',
  };
  const readFile = (p) => {
    if (!(p in graph)) throw new Error(`not found: ${p}`);
    return graph[p];
  };
  const order = resolveModuleOrder('src/a.js', readFile);
  assert.deepEqual(order, ['src/c.js', 'src/b.js', 'src/a.js']);
});

test('resolveModuleOrder: יהלום — תלות משותפת מופיעה פעם אחת, לפני שני התלויים בה', () => {
  const graph = {
    'src/a.js': "import { b } from './b.js';\nimport { c } from './c.js';\n",
    'src/b.js': "import { d } from './d.js';\n",
    'src/c.js': "import { d } from './d.js';\n",
    'src/d.js': 'const d = 1;\n',
  };
  const readFile = (p) => {
    if (!(p in graph)) throw new Error(`not found: ${p}`);
    return graph[p];
  };
  const order = resolveModuleOrder('src/a.js', readFile);
  assert.equal(order.filter((p) => p === 'src/d.js').length, 1);
  assert.ok(order.indexOf('src/d.js') < order.indexOf('src/b.js'));
  assert.ok(order.indexOf('src/d.js') < order.indexOf('src/c.js'));
  assert.equal(order[order.length - 1], 'src/a.js');
});

test('resolveModuleOrder: זורק על מעגל תלויות', () => {
  const graph = {
    'src/a.js': "import { b } from './b.js';\n",
    'src/b.js': "import { a } from './a.js';\n",
  };
  const readFile = (p) => {
    if (!(p in graph)) throw new Error(`not found: ${p}`);
    return graph[p];
  };
  assert.throws(() => resolveModuleOrder('src/a.js', readFile), /(cycle|מעגל)/i);
});

test('resolveModuleOrder: זורק על קובץ חסר', () => {
  const graph = {
    'src/a.js': "import { b } from './missing.js';\n",
  };
  const readFile = (p) => {
    if (!(p in graph)) throw new Error(`not found: ${p}`);
    return graph[p];
  };
  assert.throws(() => resolveModuleOrder('src/a.js', readFile));
});

test('resolveModuleOrder: זורק על import של node:*', () => {
  const graph = {
    'src/a.js': "import { readFileSync } from 'node:fs';\n",
  };
  const readFile = (p) => graph[p];
  assert.throws(() => resolveModuleOrder('src/a.js', readFile), /node:/);
});

// ─── findTopLevelDeclarations / assertNoDuplicateTopLevel ───────────────────
test('findTopLevelDeclarations: מזהה function/const/let/var/class ברמה עליונה', () => {
  const src = [
    'function foo() {}',
    'const bar = 1;',
    'let baz = 2;',
    'var qux = 3;',
    'class Quux {}',
    'async function corge() {}',
  ].join('\n');
  const names = findTopLevelDeclarations(src);
  assert.deepEqual(names.sort(), ['bar', 'baz', 'corge', 'foo', 'quux'.replace('quux', 'Quux'), 'qux'].sort());
});

test('assertNoDuplicateTopLevel: לא זורק כשאין כפילות', () => {
  assertNoDuplicateTopLevel([
    { path: 'src/a.js', source: 'function foo() {}\n' },
    { path: 'src/b.js', source: 'function bar() {}\n' },
  ]);
});

test('assertNoDuplicateTopLevel: זורק ומדווח שם + שני הקבצים', () => {
  assert.throws(
    () => assertNoDuplicateTopLevel([
      { path: 'src/a.js', source: 'function foo() {}\n' },
      { path: 'src/b.js', source: 'const foo = 1;\n' },
    ]),
    (err) => {
      assert.match(err.message, /foo/);
      assert.match(err.message, /src\/a\.js/);
      assert.match(err.message, /src\/b\.js/);
      return true;
    }
  );
});

// ─── buildHeader ──────────────────────────────────────────────────────────────
test('buildHeader: מכיל את כל השורות הנדרשות', () => {
  const pkg = { version: '9.9.9' };
  const header = buildHeader(pkg);
  assert.ok(header.startsWith('// ==UserScript=='));
  assert.ok(header.trim().endsWith('// ==/UserScript=='));
  assert.match(header, /@name\s+תלמוד - קליטת תלמידים/);
  assert.match(header, /@namespace\s+https:\/\/github\.com\/mdj441\/talmud-scripts/);
  assert.match(header, /@version\s+9\.9\.9/);
  assert.match(header, /@description\s+\S/);
  assert.match(header, /@author\s+מרדכי יאקאב/);
  assert.match(header, /@match\s+https:\/\/talmud\.edu\.gov\.il\/\*/);
  assert.match(header, /@grant\s+none/);
  assert.match(header, /@run-at\s+\S/);
  assert.match(header, /@supportURL\s+https:\/\/github\.com\/mdj441\/talmud-scripts\/issues/);
});

test('buildHeader: כולל @require ל-SheetJS (xlsx) לטעינת קבצי אקסל בפאנל', () => {
  const pkg = { version: '9.9.9' };
  const header = buildHeader(pkg);
  assert.match(header, /@require\s+https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\/0\.18\.5\/xlsx\.full\.min\.js/);
});

test('buildHeader: updateURL/downloadURL כוללים את שם הקובץ המקודד', () => {
  const pkg = { version: '9.9.9' };
  const header = buildHeader(pkg);
  const encoded = encodeURIComponent('talmud-קליטת-תלמידים.user.js');
  const updateLine = header.split('\n').find((l) => l.includes('@updateURL'));
  const downloadLine = header.split('\n').find((l) => l.includes('@downloadURL'));
  assert.ok(updateLine && updateLine.includes(encoded), 'updateURL כולל את שם הקובץ המקודד');
  assert.ok(downloadLine && downloadLine.includes(encoded), 'downloadURL כולל את שם הקובץ המקודד');
  assert.ok(updateLine.includes('github.com/mdj441/talmud-scripts/raw/refs/heads/main/dist/'));
});

// ─── buildUserscript על הריפו האמיתי ─────────────────────────────────────────
test('buildUserscript: הפלט מתחיל בכותרת userscript', () => {
  const pkg = JSON.parse(fsReadFile('package.json'));
  const out = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  assert.ok(out.startsWith('// ==UserScript=='));
});

test('buildUserscript: אין שורות import/export שנשארו', () => {
  const pkg = JSON.parse(fsReadFile('package.json'));
  const out = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  const bodyStart = out.indexOf("(function () {");
  const body = out.slice(bodyStart);
  assert.ok(!/^import /m.test(body));
  assert.ok(!/^export /m.test(body));
});

test('buildUserscript: הפלט תקין תחבירית (vm.Script)', () => {
  const pkg = JSON.parse(fsReadFile('package.json'));
  const out = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  assert.doesNotThrow(() => new vm.Script(out, { filename: 'talmud-קליטת-תלמידים.user.js' }));
});

test('buildUserscript: דטרמיניסטי — זהה בית-לבית בשתי ריצות', () => {
  const pkg = JSON.parse(fsReadFile('package.json'));
  const out1 = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  const out2 = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  assert.equal(out1, out2);
});

test('buildUserscript: זהה לקובץ dist המחויב (מצפין את הדטרמיניזם ל-CI)', () => {
  const pkg = JSON.parse(fsReadFile('package.json'));
  const out = buildUserscript({ pkg, entry: 'src/absorb-main.js', readFile: fsReadFile });
  const committed = readFileSync(DIST_PATH, 'utf8');
  assert.equal(out, committed);
});
