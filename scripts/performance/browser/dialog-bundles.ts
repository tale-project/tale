import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { dialogProductPair } from './dialog-sources.mjs';

const pathSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_./-]+$/)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    'Unsafe artifact path',
  );
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const filesSchema = z
  .array(z.object({ path: pathSchema, sha256: sha }).strict())
  .length(640);
const manifestSchema = z
  .object({
    run: z.literal(37189059988),
    attempt: z.literal(1),
    artifactId: z.literal(11299468224),
    artifactZipSha256: z.literal(
      '67960267aa8d355125c46f38dc4e0766ae69bc567974f42ce43a9f6ae6682a0b',
    ),
    baseline: z.literal(dialogProductPair.baseline),
    candidate: z.literal(dialogProductPair.candidate),
    arms: z
      .object({
        baseline: z.object({ files: filesSchema }).strict(),
        candidate: z.object({ files: filesSchema }).strict(),
      })
      .strict(),
  })
  .strict();

export function parseDialogBundles(value: unknown) {
  const manifest = manifestSchema.parse(value);
  for (const { files } of Object.values(manifest.arms)) {
    assert.equal(
      new Set(files.map((file) => file.path)).size,
      files.length,
      'Duplicate historical bundle path',
    );
    for (const required of ['index.html', 'sw.js'])
      assert(
        files.some((file) => file.path === required),
        `Missing ${required}`,
      );
    assert(
      files.some((file) => file.path.endsWith('.js.map')),
      'Missing historical source maps',
    );
  }
  return manifest;
}

export async function dialogBundleReference() {
  const bytes = await readFile(
    new URL('./dialog-bundles.json', import.meta.url),
  );
  return {
    manifest: parseDialogBundles(JSON.parse(bytes.toString())),
    manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** Actual hashes are retained regardless of parity. A mismatch is evidence,
 * never an invitation to silently drop maps, HTML or an unexpected file. */
export function compareDialogBundle(
  actual: Record<string, string>,
  expected: { path: string; sha256: string }[],
) {
  for (const [path, hash] of Object.entries(actual)) {
    pathSchema.parse(path);
    sha.parse(hash);
  }
  assert.equal(
    new Set(expected.map((file) => file.path)).size,
    expected.length,
    'Duplicate expected path',
  );
  const pinned = new Map(expected.map((file) => [file.path, file.sha256]));
  const differences = [];
  for (const [path, hash] of Object.entries(actual)) {
    if (!pinned.has(path))
      differences.push({ path, reason: 'added', actual: hash });
    else if (pinned.get(path) !== hash)
      differences.push({
        path,
        reason: 'changed',
        expected: pinned.get(path),
        actual: hash,
      });
  }
  for (const [path, hash] of pinned)
    if (!Object.hasOwn(actual, path))
      differences.push({ path, reason: 'missing', expected: hash });
  return {
    matches: differences.length === 0,
    actualCount: Object.keys(actual).length,
    expectedCount: expected.length,
    differences,
  };
}
