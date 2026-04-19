import { mkdir, rm, copyFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(currentDir, '..');
const distDir = resolve(rootDir, 'dist');

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [resolve(rootDir, 'app.jsx')],
  outfile: resolve(distDir, 'app.js'),
  format: 'iife',
  target: 'es2018',
  bundle: false,
});

await Promise.all([
  copyFile(resolve(rootDir, 'index.html'), resolve(distDir, 'index.html')),
  copyFile(resolve(rootDir, 'guppy-engine.js'), resolve(distDir, 'guppy-engine.js')),
  writeFile(resolve(distDir, '.nojekyll'), ''),
]);
