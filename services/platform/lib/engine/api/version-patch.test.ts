// @vitest-environment node

import { applyPatch } from 'diff';
import { describe, expect, it } from 'vitest';

import { shippedDocuments } from '../selftest/corpus';
import { documentYaml } from './document-yaml';
import { MAX_PATCH_BYTES, unifiedPatch } from './version-patch';

const LABELS = { fromLabel: 'v4', toLabel: 'v5' };

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, at) => `${prefix} ${at + 1}\n`).join(
    '',
  );
}

describe('unifiedPatch', () => {
  it('writes the file headers and hunks git reads', () => {
    const before = lines(10);
    const after = before.replace('line 5\n', 'line five\n');
    expect(unifiedPatch(before, after, LABELS)).toEqual({
      patch: [
        '--- v4',
        '+++ v5',
        '@@ -2,7 +2,7 @@',
        ' line 2',
        ' line 3',
        ' line 4',
        '-line 5',
        '+line five',
        ' line 6',
        ' line 7',
        ' line 8',
        '',
      ].join('\n'),
      truncated: false,
    });
  });

  it('keeps as many unchanged lines around a change as asked', () => {
    const before = lines(10);
    const after = before.replace('line 5\n', 'line five\n');
    const { patch } = unifiedPatch(before, after, { ...LABELS, context: 1 });
    expect(patch.split('\n').slice(2, 6)).toEqual([
      '@@ -4,3 +4,3 @@',
      ' line 4',
      '-line 5',
      '+line five',
    ]);
  });

  it('has no patch for two equal texts', () => {
    expect(unifiedPatch('a\n', 'a\n', LABELS)).toEqual({
      patch: '',
      truncated: false,
    });
  });

  it('turns one version into the next when applied', () => {
    const [first, second] = shippedDocuments();
    if (first === undefined || second === undefined)
      throw new Error('no corpus');
    const before = documentYaml(first.document);
    const after = documentYaml({
      ...second.document,
      name: first.document.name,
    });
    const { patch, truncated } = unifiedPatch(before, after, LABELS);
    expect(truncated).toBe(false);
    expect(applyPatch(before, patch)).toBe(after);
  });

  it('cuts a patch past its size at the last whole line that fits', () => {
    const before = lines(400, 'old 😀');
    const after = lines(400, 'new 😀');
    const whole = unifiedPatch(before, after, LABELS).patch;
    const maxBytes = 1_000;
    const { patch, truncated } = unifiedPatch(before, after, {
      ...LABELS,
      maxBytes,
    });
    expect(truncated).toBe(true);
    expect(new TextEncoder().encode(patch).length).toBeLessThanOrEqual(
      maxBytes,
    );
    expect(patch.endsWith('\n')).toBe(true);
    expect(whole.startsWith(patch)).toBe(true);
    // The next whole line would not have fit.
    const next = whole.slice(
      patch.length,
      whole.indexOf('\n', patch.length) + 1,
    );
    expect(new TextEncoder().encode(patch + next).length).toBeGreaterThan(
      maxBytes,
    );
  });

  it('answers a whole patch up to the default size', () => {
    expect(MAX_PATCH_BYTES).toBe(262_144);
    const before = lines(500);
    const after = lines(500, 'changed');
    expect(unifiedPatch(before, after, LABELS).truncated).toBe(false);
  });
});
