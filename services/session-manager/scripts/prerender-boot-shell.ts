#!/usr/bin/env bun
/*
  Build step, after `vite build` (`bun run build`): bakes the boot shell, the
  frame of the app with its rail masked, into the `#root` of the built
  `index.html`, so the first paint of every address is that frame rather than
  a blank page while the scripts load. The server answers every
  address with this one file, so the shell needs no work at request time.
  Rendered from the component React draws over it
  (`app/components/layout/app-frame-placeholder.tsx`): no hand-written copy to
  drift from it.

  The directory is `dist`, or the first argument (a page built elsewhere, as
  `bunx --bun vite build --outDir <dir>` makes one).

  It also names the fonts the first frame draws with in the page's head
  (`withFontPreloads`), so they load with the page and its text never
  changes face a frame after it is drawn.
*/

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { withBootShell } from '../app/components/layout/boot-shell.tsx';
import { withFontPreloads } from './font-preloads.ts';

const distDir = resolve(
  process.argv[2] ?? join(import.meta.dirname, '..', 'dist'),
);
const file = join(distDir, 'index.html');

if (!existsSync(file)) {
  console.error(
    `prerender-boot-shell: ${file} not found; run \`vite build\` first.`,
  );
  process.exit(1);
}

const html = readFileSync(file, 'utf8');
if (html.includes('data-boot-shell')) {
  console.info(`prerender-boot-shell: ${file} has its boot shell already`);
  process.exit(0);
}
const shelled = withBootShell(html);
if (shelled === html) {
  console.error(
    `prerender-boot-shell: ${file} has no empty #root to put the shell in.`,
  );
  process.exit(1);
}
const assets = readdirSync(join(distDir, 'assets'));
const preloaded = withFontPreloads(shelled, assets);
writeFileSync(file, preloaded);
console.info(
  `prerender-boot-shell: wrote the boot shell and ${preloaded === shelled ? 'no font preload' : 'the font preloads'} into ${file} (${preloaded.length - html.length} bytes)`,
);
