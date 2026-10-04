import { expect, test } from 'bun:test';

import {
  compareDialogBundle,
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
