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

import ts from 'typescript';

interface PrecacheEntry {
  url: string;
  revision: string | null;
}

/** The manifest passed to Workbox, including a bundled/minified runtime. */
export function parsePrecacheManifest(source: string): PrecacheEntry[] {
  const file = ts.createSourceFile(
    'sw.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const manifests: PrecacheEntry[][] = [];
  const property = (object: ts.ObjectLiteralExpression, key: string) =>
    object.properties.find(
      (member): member is ts.PropertyAssignment =>
        ts.isPropertyAssignment(member) &&
        (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) &&
        member.name.text === key,
    )?.initializer;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const argument of node.arguments) {
        if (
          !ts.isArrayLiteralExpression(argument) ||
          !argument.elements.some(
            (entry) =>
              ts.isObjectLiteralExpression(entry) &&
              property(entry, 'url') !== undefined &&
              property(entry, 'revision') !== undefined,
          )
        )
          continue;
        manifests.push(
          argument.elements.map((entry) => {
            if (!ts.isObjectLiteralExpression(entry))
              throw new Error('unreadable precache entry');
            const url = property(entry, 'url');
            const revision = property(entry, 'revision');
            if (
              !url ||
              !ts.isStringLiteral(url) ||
              !revision ||
              (!ts.isStringLiteral(revision) &&
                revision.kind !== ts.SyntaxKind.NullKeyword)
            ) {
              throw new Error('unreadable precache entry');
            }
            return {
              url: url.text,
              revision: ts.isStringLiteral(revision) ? revision.text : null,
            };
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (manifests.length !== 1 || !manifests[0])
    throw new Error(
      'expected one precacheAndRoute manifest in the service worker',
    );
  return manifests[0];
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
  for (const required of [
    'offline.html',
    'pwa-recovery.js',
    'pwa-build.json',
  ]) {
    if (!entries.some((entry) => entry.url === required))
      defects.push(`${required} is not precached`);
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
