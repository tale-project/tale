import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import {
  compareDialogBundle,
  compareDialogBuild,
  dialogMapPaths,
  normalizeDialogMap,
  dialogBundleReference,
  parseDialogBundles,
} from './browser/dialog-bundles.ts';

const reference = await dialogBundleReference();

test('both retained historical bundles have complete unique safe paths and immutable artifact/source provenance', () => {
  expect(reference.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  for (const arm of ['baseline', 'candidate'] as const) {
    const files = reference.manifest.arms[arm].files;
    expect(files).toHaveLength(640);
    expect(
      compareDialogBundle(
        Object.fromEntries(files.map((file) => [file.path, file.sha256])),
        files,
      ).matches,
    ).toBe(true);
  }
});

test('source, artifact, count, duplicate and traversal mismatches refuse the historical reference', () => {
  for (const mutate of [
    (copy: typeof reference.manifest) => {
      copy.arms.candidate.files.pop();
    },
    (copy: typeof reference.manifest) => {
      copy.arms.baseline.files[1] = copy.arms.baseline.files[0]!;
    },
    (copy: typeof reference.manifest) => {
      copy.arms.candidate.files[0]!.path = '../outside.js';
    },
    (copy: typeof reference.manifest) => {
      copy.arms.candidate.files[0]!.path = '/absolute.js';
    },
    (copy: typeof reference.manifest) => {
      copy.arms.candidate.files[0]!.path = 'assets//empty.js';
    },
    (copy: typeof reference.manifest) => {
      copy.arms.baseline.mapMetadata.entrySha256 = 'invalid';
    },
    (copy: typeof reference.manifest) => {
      Object.assign(copy.arms.baseline.mapMetadata, { unsupported: true });
    },
    (copy: typeof reference.manifest) => {
      copy.arms.baseline.files[0]!.path += '.map';
    },
    (copy: typeof reference.manifest) => {
      copy.arms.baseline.files.find(({ path }) => path === 'sw.js.map')!.path =
        'renamed.js.map';
    },
  ]) {
    const copy = structuredClone(reference.manifest);
    mutate(copy);
    expect(() => parseDialogBundles(copy)).toThrow();
  }
  expect(() => parseDialogBundles({ ...reference.manifest, run: 1 })).toThrow();
  expect(() =>
    parseDialogBundles({ ...reference.manifest, candidate: 'f'.repeat(40) }),
  ).toThrow();
});

test('added, missing and byte-changed assets each produce explicit refusal evidence, including HTML and maps', () => {
  const hash = 'a'.repeat(64);
  const changed = 'b'.repeat(64);
  const expected = [
    { path: 'index.html', sha256: hash },
    { path: 'assets/app.js.map', sha256: hash },
  ];
  const result = compareDialogBundle(
    { 'index.html': changed, 'assets/new.js': hash },
    expected,
  );
  expect(result.matches).toBe(false);
  expect(result.differences).toEqual([
    { path: 'index.html', reason: 'changed', expected: hash, actual: changed },
    { path: 'assets/new.js', reason: 'added', actual: hash },
    { path: 'assets/app.js.map', reason: 'missing', expected: hash },
  ]);
  expect(() =>
    compareDialogBundle({ '../escaped.js': hash }, expected),
  ).toThrow();
  expect(() =>
    compareDialogBundle({ 'index.html': 'invalid' }, expected),
  ).toThrow();
  expect(() => compareDialogBundle({}, [...expected, expected[0]!])).toThrow(
    'Duplicate',
  );
});

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const assetSource = (weight: number) =>
  `../../../../node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff2?url`;
const assetModule = (token: string) =>
  `export default "__VITE_ASSET__${token.repeat(22)}__"`;

function fixture(arm: 'baseline' | 'candidate' = 'baseline') {
  const paths = dialogMapPaths[arm];
  const entry = {
    version: 3,
    mappings: 'AAAA',
    names: ['untouched'],
    ignoreList: [0],
    sources: ['source.ts', assetSource(400), assetSource(500)],
    sourcesContent: [
      'export const original = 1;',
      assetModule('A'),
      assetModule('B'),
    ],
    file: paths.entry.split('/').at(-1)!.slice(0, -4),
  };
  const worker = {
    version: 3,
    file: 'sw.js',
    sources: [`../../../../../../../tmp/${'a'.repeat(32)}/sw.js`],
    sourcesContent: ['const worker = 1;'],
    names: ['worker'],
    mappings: 'AAAA',
  };
  const normalizedEntry = structuredClone(entry);
  normalizedEntry.sourcesContent[1] =
    'export default "__VITE_ASSET__INTER_LATIN_400__"';
  normalizedEntry.sourcesContent[2] =
    'export default "__VITE_ASSET__INTER_LATIN_500__"';
  const normalizedWorker = structuredClone(worker);
  normalizedWorker.sources[0] = '../../../../../../../tmp/WORKBOX_TEMP/sw.js';
  const expected = structuredClone(reference.manifest.arms[arm]);
  expected.files.find(({ path }) => path === paths.entry)!.sha256 = digest(
    encode(entry),
  );
  expected.files.find(({ path }) => path === paths.worker)!.sha256 = digest(
    encode(worker),
  );
  expected.mapMetadata = {
    entrySha256: digest(encode(normalizedEntry)),
    workerSha256: digest(encode(normalizedWorker)),
  };
  return { arm, paths, entry, worker, expected };
}

async function compareFixture(
  value: ReturnType<typeof fixture>,
  overrides: Record<string, Uint8Array> = {},
) {
  const bytes = {
    [value.paths.entry]: encode(value.entry),
    [value.paths.worker]: encode(value.worker),
    ...overrides,
  };
  const actual = Object.fromEntries(
    value.expected.files.map(({ path, sha256 }) => [path, sha256]),
  );
  for (const [path, content] of Object.entries(bytes))
    actual[path] = digest(content);
  return compareDialogBuild(
    actual,
    value.expected,
    value.arm,
    async (path) => bytes[path]!,
  );
}

for (const arm of ['baseline', 'candidate'] as const) {
  test(`${arm}: only generated metadata changes are accepted, with original raw drift retained`, async () => {
    const value = fixture(arm);
    value.entry.sourcesContent[1] = assetModule('B');
    value.entry.sourcesContent[2] = assetModule('A');
    value.worker.sources[0] = `../../../../../../../tmp/${'b'.repeat(32)}/sw.js`;
    const result = await compareFixture(value);
    expect(result.matches).toBe(true);
    expect(result.rawMatches).toBe(false);
    expect(result.differences).toHaveLength(2);
    expect(result.unresolvedDifferences).toEqual([]);
    expect(result.metadataComparisons).toHaveLength(2);
    expect(result.metadataComparisons.every((item) => item.matches)).toBe(true);
    expect(value.entry.sourcesContent[1]).toBe(assetModule('B'));
    expect(value.worker.sources[0]).toContain('b'.repeat(32));
  });
}

test('exact raw equality does not invoke normalization or read maps', async () => {
  const value = fixture();
  const actual = Object.fromEntries(
    value.expected.files.map(({ path, sha256 }) => [path, sha256]),
  );
  const result = await compareDialogBuild(
    actual,
    value.expected,
    'baseline',
    async () => {
      throw new Error('must not read');
    },
  );
  expect(result.matches).toBe(true);
  expect(result.rawMatches).toBe(true);
  expect(result.metadataComparisons).toEqual([]);
});

test('entry mappings, source text, order, names, file, ignoreList and unsupported fields stay guarded', async () => {
  for (const mutate of [
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.mappings += 'B';
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sourcesContent[0] += 'changed';
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sources.reverse();
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.names.push('changed');
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.file = 'wrong.js';
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.ignoreList.push(1);
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      Object.assign(entry, { unsupported: true });
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sourcesContent[1] = assetModule('A') + '; alert(1)';
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sources[1] = assetSource(600);
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sources[2] = assetSource(400);
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sourcesContent[2] = entry.sourcesContent[1]!;
    },
    (entry: ReturnType<typeof fixture>['entry']) => {
      entry.sourcesContent.pop();
    },
  ]) {
    const value = fixture();
    mutate(value.entry);
    const result = await compareFixture(value);
    expect(result.matches).toBe(false);
    expect(result.unresolvedDifferences).toHaveLength(1);
  }
});

test('worker changes outside the exact temp segment refuse, including content and source identity', async () => {
  for (const mutate of [
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.mappings += 'B';
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.sourcesContent[0] += 'changed';
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.names.push('changed');
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.sources[0] = worker.sources[0]!.replace('/tmp/', '/var/');
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.sources[0] = worker.sources[0]!.replace('sw.js', 'other.js');
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.sources[0] = worker.sources[0]!.replace(
        'a'.repeat(32),
        'a'.repeat(31),
      );
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      worker.sources.push(worker.sources[0]!);
      worker.sourcesContent.push('extra');
    },
    (worker: ReturnType<typeof fixture>['worker']) => {
      Object.assign(worker, { sourceRoot: '/elsewhere' });
    },
  ]) {
    const value = fixture();
    mutate(value.worker);
    const result = await compareFixture(value);
    expect(result.matches).toBe(false);
    expect(result.unresolvedDifferences).toHaveLength(1);
  }
});

test('malformed, noncompact, duplicate-key and invalid UTF-8 map bytes refuse with retained error', async () => {
  const value = fixture();
  for (const bytes of [
    Buffer.from('{'),
    Buffer.from(JSON.stringify(value.entry, null, 2)),
    Buffer.from(JSON.stringify(value.entry).replace('{', '{"version":3,')),
    Buffer.concat([encode(value.entry), Buffer.from([255])]),
    Buffer.concat([Buffer.from([239, 187, 191]), encode(value.entry)]),
    Buffer.from(JSON.stringify(value.entry) + '\n'),
    Buffer.alloc(20 * 1024 * 1024 + 1),
  ]) {
    const result = await compareFixture(value, { [value.paths.entry]: bytes });
    expect(result.matches).toBe(false);
    expect(result.metadataComparisons[0]).toHaveProperty('error');
  }
});

test('metadata rule never excuses HTML, JS, CSS, font, other map or added/missing file drift', async () => {
  const value = fixture();
  for (const changedPath of [
    'index.html',
    'sw.js',
    value.expected.files.find(({ path }) => path.endsWith('.css'))!.path,
    value.expected.files.find(({ path }) => path.endsWith('.woff2'))!.path,
    value.expected.files.find(
      ({ path }) =>
        path.endsWith('.map') &&
        path !== value.paths.entry &&
        path !== value.paths.worker,
    )!.path,
    'assets/added.js',
  ]) {
    expect(
      (await compareFixture(value, { [changedPath]: Buffer.from('changed') }))
        .matches,
    ).toBe(false);
  }
  const actual = Object.fromEntries(
    value.expected.files.map(({ path, sha256 }) => [path, sha256]),
  );
  delete actual[value.paths.worker];
  expect(
    (
      await compareDialogBuild(actual, value.expected, 'baseline', async () =>
        encode(value.worker),
      )
    ).matches,
  ).toBe(false);
  expect(() =>
    normalizeDialogMap('candidate', value.paths.entry, encode(value.entry)),
  ).toThrow('Unsupported');
});

test('map read/hash errors and wrong normalized reference never turn into acceptance', async () => {
  const value = fixture();
  value.worker.sources[0] = value.worker.sources[0]!.replace(
    'a'.repeat(32),
    'b'.repeat(32),
  );
  const actual = Object.fromEntries(
    value.expected.files.map(({ path, sha256 }) => [path, sha256]),
  );
  actual[value.paths.worker] = digest(encode(value.worker));
  for (const read of [
    async () => {
      throw new Error('retained read failure');
    },
    async () => Buffer.from('wrong bytes'),
  ]) {
    const result = await compareDialogBuild(
      actual,
      value.expected,
      'baseline',
      read,
    );
    expect(result.matches).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.metadataComparisons[0]).toHaveProperty('error');
  }
  value.expected.mapMetadata.workerSha256 = 'f'.repeat(64);
  expect((await compareFixture(value)).matches).toBe(false);
});
