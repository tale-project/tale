/**
 * Pin the built service worker's precache manifest to what an offline shell
 * needs: every URL once, every entry revisioned.
 *
 * Runs after `vite build` (the `build` script and the image build). The
 * generated `dist/sw.js` used to list nine files twice — once hashed from
 * `public/` by vite-plugin-pwa's `includeAssets`, once `revision: null`
 * from a workbox glob over `dist/assets/` — and workbox-precaching refuses a
 * URL with two revisions at install (`add-to-cache-list-conflicting-entries`),
 * so the worker activated with an empty cache and no offline page while the
 * client announced "ready to work offline" (2026-09-26 evaluation, G-05).
 *
 * Usage (from `services/platform`): `bun scripts/check-sw-manifest.ts [dist/sw.js]`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PrecacheEntry {
  url: string;
  revision: string | null;
}

/** The `precacheAndRoute([...])` entries of a generated (minified) sw.js. */
export function parsePrecacheManifest(source: string): PrecacheEntry[] {
  const start = source.indexOf('precacheAndRoute([');
  if (start === -1) {
    throw new Error('no precacheAndRoute([...]) call in the service worker');
  }
  const open = source.indexOf('[', start);
  const close = source.indexOf(']', open);
  if (close === -1) throw new Error('unterminated precache manifest');
  const list = source.slice(open + 1, close);
  const entries: PrecacheEntry[] = [];
  for (const match of list.matchAll(/\{([^{}]*)\}/g)) {
    const body = match[1] ?? '';
    const url = /(?:^|,)\s*"?url"?\s*:\s*"([^"]*)"/.exec(body)?.[1];
    const revision = /(?:^|,)\s*"?revision"?\s*:\s*(null|"[^"]*")/.exec(
      body,
    )?.[1];
    if (url === undefined || revision === undefined) {
      throw new Error(`unreadable precache entry: {${body}}`);
    }
    entries.push({
      url,
      revision: revision === 'null' ? null : revision.slice(1, -1),
    });
  }
  return entries;
}

/** Every finding that makes the manifest unusable; empty when it is sound. */
export function findManifestDefects(entries: PrecacheEntry[]): string[] {
  const defects: string[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries)
    seen.set(entry.url, (seen.get(entry.url) ?? 0) + 1);
  for (const [url, count] of seen) {
    if (count > 1) defects.push(`${url} is listed ${count} times`);
  }
  for (const entry of entries) {
    // A Vite-hashed bundle carries its revision in its name; everything
    // else must be revisioned or it is never refreshed after a deploy.
    const hashedName = /[.-][0-9A-Za-z_-]{8,}\.(?:js|css)$/.test(entry.url);
    if (entry.revision === null && !hashedName) {
      defects.push(`${entry.url} has no revision`);
    }
  }
  if (!entries.some((entry) => entry.url === 'offline.html')) {
    defects.push('offline.html is not precached');
  }
  return defects;
}

if (import.meta.main) {
  const target = resolve(process.argv[2] ?? 'dist/sw.js');
  const entries = parsePrecacheManifest(readFileSync(target, 'utf8'));
  const defects = findManifestDefects(entries);
  if (defects.length > 0) {
    console.error(`Service worker precache manifest in ${target} is unusable:`);
    for (const defect of defects) console.error(`  - ${defect}`);
    process.exit(1);
  }
  console.log(
    `Service worker precache manifest: ${entries.length} entries, unique and revisioned`,
  );
}
