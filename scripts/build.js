import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(root, 'public', 'build');
const vendorDir = path.join(root, 'public', 'vendor');
await rm(outDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ['src/client.js'],
  bundle: true,
  splitting: true,
  format: 'esm',
  target: ['es2022'],
  external: [],
  outdir: outDir,
  entryNames: 'app',
  chunkNames: 'chunks/[name]-[hash]',
  minify: true,
  sourcemap: false,
  legalComments: 'none'
});
const pdfDir = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
await copyFile(path.join(pdfDir, 'pdf.mjs'), path.join(vendorDir, 'pdf.mjs'));
await copyFile(path.join(pdfDir, 'pdf.worker.mjs'), path.join(vendorDir, 'pdf.worker.mjs'));
console.log('Built the app and copied the local PDF text parser.');
