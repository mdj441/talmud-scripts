import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

// Ordered list of source modules to concatenate into the userscript.
const MODULES = [
  'src/absorb-main.js',
];

const HEADER = `// ==UserScript==
// @name         תלמוד - קליטת תלמידים
// @namespace    https://github.com/mdj441/talmud-scripts
// @version      ${pkg.version}
// @match        https://talmud.edu.gov.il/*
// @grant        none
// @author       מרדכי יאקאב
// ==/UserScript==`;

// Simple pass: drop `import ...` lines and strip the `export ` keyword.
// Task 8 hardens this into a real module resolver.
function stripModuleSyntax(source) {
  return source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace(/^export /gm, '');
}

const body = MODULES
  .map((path) => readFileSync(join(__dirname, path), 'utf8'))
  .map(stripModuleSyntax)
  .join('\n');

const output = `${HEADER}\n\n(function () {\n  'use strict';\n\n${body}\n})();\n`;

const distDir = join(__dirname, 'dist');
mkdirSync(distDir, { recursive: true });

const outPath = join(distDir, 'talmud-קליטת-תלמידים.user.js');
writeFileSync(outPath, output, 'utf8');

console.log(`Built ${outPath} (v${pkg.version})`);
