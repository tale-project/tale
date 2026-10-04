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
const armSchema = z
  .object({
    files: filesSchema,
    mapMetadata: z.object({ entrySha256: sha, workerSha256: sha }).strict(),
  })
  .strict();
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
        baseline: armSchema,
        candidate: armSchema,
      })
      .strict(),
  })
  .strict();

export function parseDialogBundles(value: unknown) {
  const manifest = manifestSchema.parse(value);
  for (const [arm, { files }] of Object.entries(manifest.arms)) {
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
    assert.equal(
      files.filter((file) => !file.path.endsWith('.map')).length,
      411,
    );
    for (const path of Object.values(dialogMapPaths[arm as DialogArm]))
      assert(
        files.some((file) => file.path === path),
        `Missing ${path}`,
      );
  }
  return manifest;
}

type DialogArm = 'baseline' | 'candidate';
export const dialogMapPaths = {
  baseline: { entry: 'assets/index-DjTRJLyl.js.map', worker: 'sw.js.map' },
  candidate: { entry: 'assets/index-BXl8tjOG.js.map', worker: 'sw.js.map' },
} as const;

const mapFields = {
  version: z.literal(3),
  file: z.string(),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string()),
  names: z.array(z.string()),
  mappings: z.string(),
};
const entryMapSchema = z
  .object({ ...mapFields, ignoreList: z.array(z.number().int().nonnegative()) })
  .strict();
const workerMapSchema = z.object(mapFields).strict();

/** Compare only two witnessed generator fields, never rewrite a retained map.
 * Compact round-trip equality rejects duplicate keys, whitespace, invalid UTF-8
 * and alternate escapes. The digest covers every other serialized byte. */
export function normalizeDialogMap(
  arm: DialogArm,
  path: string,
  bytes: Uint8Array,
) {
  assert(
    bytes.byteLength <= 20 * 1024 * 1024,
    'Source map exceeds evidence bound',
  );
  const text = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const value: unknown = JSON.parse(text);
  assert(
    JSON.stringify(value) === text,
    'Source map must be compact unique-key JSON',
  );
  const kind = path === dialogMapPaths[arm].entry ? 'entry' : 'worker';
  assert.equal(
    path,
    dialogMapPaths[arm][kind],
    'Unsupported map normalization path',
  );
  // Validate without replacing the parsed object: key order is part of the hash.
  const parsed =
    kind === 'entry'
      ? entryMapSchema.parse(value)
      : workerMapSchema.parse(value);
  assert.equal(parsed.file, path.split('/').at(-1)!.slice(0, -4));
  assert.equal(parsed.sources.length, parsed.sourcesContent.length);
  const map = value as z.infer<typeof workerMapSchema>;
  const replacements: {
    field: string;
    index: number;
    source: string;
    before: string;
    after: string;
  }[] = [];
  if (kind === 'entry') {
    const tokens = new Set<string>();
    for (const weight of [400, 500]) {
      const source = `../../../../node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2?url`;
      const indices = map.sources.flatMap((name, index) =>
        name === source ? [index] : [],
      );
      assert.equal(indices.length, 1, 'Asset source identity must be unique');
      const index = indices[0]!;
      const before = map.sourcesContent[index]!;
      assert.match(
        before,
        /^export default "__VITE_ASSET__[A-Za-z0-9_$]{22}__"$/,
        'Unexpected generated asset module',
      );
      tokens.add(before);
      const after = `export default "__VITE_ASSET__INTER_LATIN_${weight}__"`;
      map.sourcesContent[index] = after;
      replacements.push({
        field: 'sourcesContent',
        index,
        source,
        before,
        after,
      });
    }
    assert.equal(
      tokens.size,
      2,
      'Distinct assets must retain distinct reference IDs',
    );
  } else {
    assert.equal(map.sources.length, 1, 'Worker map must retain one source');
    const before = map.sources[0]!;
    assert.match(
      before,
      /^(\.\.\/){7}tmp\/[a-f0-9]{32}\/sw\.js$/,
      'Unexpected worker temporary path',
    );
    const after = '../../../../../../../tmp/WORKBOX_TEMP/sw.js';
    map.sources[0] = after;
    replacements.push({
      field: 'sources',
      index: 0,
      source: before,
      before,
      after,
    });
  }
  return {
    kind,
    sha256: createHash('sha256').update(JSON.stringify(map)).digest('hex'),
    replacements,
  };
}

/** Raw drift remains visible, including when a narrowly classified metadata
 * difference is accepted. Read/parse/hash failures stay explicit mismatches. */
export async function compareDialogBuild(
  actual: Record<string, string>,
  expected: z.infer<typeof armSchema>,
  arm: DialogArm,
  readMap: (path: string) => Promise<Uint8Array>,
) {
  const raw = compareDialogBundle(actual, expected.files);
  const metadataComparisons = [];
  const accepted = new Set<string>();
  for (const difference of raw.differences) {
    const path = difference.path;
    if (
      difference.reason !== 'changed' ||
      (path !== dialogMapPaths[arm].entry &&
        path !== dialogMapPaths[arm].worker)
    )
      continue;
    try {
      const bytes = await readMap(path);
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        actual[path],
        'Map bytes differ from retained raw manifest',
      );
      const normalized = normalizeDialogMap(arm, path, bytes);
      const expectedSha256 =
        normalized.kind === 'entry'
          ? expected.mapMetadata.entrySha256
          : expected.mapMetadata.workerSha256;
      const matches = normalized.sha256 === expectedSha256;
      metadataComparisons.push({
        path,
        ...normalized,
        expectedSha256,
        matches,
      });
      if (matches) accepted.add(path);
    } catch (error) {
      metadataComparisons.push({ path, matches: false, error: String(error) });
    }
  }
  const unresolvedDifferences = raw.differences.filter(
    ({ path }) => !accepted.has(path),
  );
  return {
    ...raw,
    rawMatches: raw.matches,
    matches: unresolvedDifferences.length === 0,
    metadataComparisons,
    unresolvedDifferences,
  };
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
