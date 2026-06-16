// The steer filename contract + consumed-marker intersection shared by the
// delivery action, the drain's consumption poll, and the terminal
// reconciliation. Pure functions — no mocks.

import { describe, expect, it } from 'vitest';

import {
  matchConsumedSteerFiles,
  steerDirFor,
  steerFileName,
} from './steer_files';

describe('steerFileName', () => {
  it('zero-pads createdAt so lexicographic glob order is send order', () => {
    const early = steerFileName(99, 'm1');
    const late = steerFileName(1_700_000_000_000, 'm2');
    expect(early).toBe('steer-000000000000099-m1.json');
    expect(early < late).toBe(true);
  });
});

describe('steerDirFor', () => {
  it('keys the dir by execId', () => {
    expect(steerDirFor('exec_1')).toBe('.runtime/tale/steer/exec_1');
  });
});

describe('matchConsumedSteerFiles', () => {
  const rowB = { messageId: 'mB', createdAt: 100 };
  const rowC = { messageId: 'mC', createdAt: 200 };
  const consumedName = (row: { messageId: string; createdAt: number }) =>
    `consumed.${steerFileName(row.createdAt, row.messageId)}`;

  it('returns the ids whose staged file was renamed to consumed.*', () => {
    const entries = [
      { name: consumedName(rowB), type: 'file' },
      { name: steerFileName(rowC.createdAt, rowC.messageId), type: 'file' },
    ];
    expect(matchConsumedSteerFiles([rowB, rowC], entries)).toEqual(['mB']);
  });

  it('returns [] for a null listing (dir or session gone = stay pending)', () => {
    expect(matchConsumedSteerFiles([rowB], null)).toEqual([]);
  });

  it('ignores unconsumed steer files, claim temps, dirs, and unrelated names', () => {
    const entries = [
      { name: steerFileName(rowB.createdAt, rowB.messageId), type: 'file' },
      {
        name: `.claimed.123.${steerFileName(rowB.createdAt, rowB.messageId)}`,
        type: 'file',
      },
      { name: consumedName(rowB), type: 'dir' },
      { name: 'consumed.unrelated.json', type: 'file' },
    ];
    expect(matchConsumedSteerFiles([rowB], entries)).toEqual([]);
  });

  it('requires the exact createdAt+messageId filename to match', () => {
    // Same messageId staged at a different createdAt must not count — the
    // filename is the contract, not the id alone.
    const entries = [
      { name: consumedName({ ...rowB, createdAt: 101 }), type: 'file' },
    ];
    expect(matchConsumedSteerFiles([rowB], entries)).toEqual([]);
  });

  it('returns only the consumed subset when the hook consumed some files', () => {
    const entries = [
      { name: consumedName(rowB), type: 'file' },
      { name: consumedName(rowC), type: 'file' },
    ];
    expect(matchConsumedSteerFiles([rowB, rowC], entries)).toEqual([
      'mB',
      'mC',
    ]);
    expect(matchConsumedSteerFiles([rowC], entries)).toEqual(['mC']);
  });

  it('returns [] for empty inputs', () => {
    expect(matchConsumedSteerFiles([], [{ name: 'x', type: 'file' }])).toEqual(
      [],
    );
    expect(matchConsumedSteerFiles([rowB], [])).toEqual([]);
  });
});
