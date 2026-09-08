import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const files = ['main.mjs', 'preload.cjs', 'renderer/renderer.js'];
for (const dir of ['scripts', 'tests']) {
  for (const name of await readdir(join(root, dir))) if (/\.(mjs|cjs|js)$/.test(name)) files.push(join(dir, name));
}
for (const file of files) execFileSync(process.execPath, ['--check', join(root, file)], { stdio: 'inherit' });
console.log(`Syntax checks passed (${files.length} files).`);
