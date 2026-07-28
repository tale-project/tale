import { describe, expect, it } from 'vitest';

import {
  isProducedByRun,
  matchesPattern,
  splitFolderFiles,
} from './folder-files';

describe('isProducedByRun', () => {
  it('reads the workflow store stamp', () => {
    expect(isProducedByRun({ sourceProvider: 'agent' })).toBe(true);
  });

  it('counts an upload and an unstamped row as not produced', () => {
    expect(isProducedByRun({ sourceProvider: 'upload' })).toBe(false);
    expect(isProducedByRun({})).toBe(false);
  });
});

describe('matchesPattern', () => {
  it('matches an exact name and nothing else', () => {
    expect(matchesPattern('return.xml', 'return.xml')).toBe(true);
    expect(matchesPattern('return.xml.bak', 'return.xml')).toBe(false);
  });

  it('treats a dot as literal, not "any character"', () => {
    expect(matchesPattern('returnXxml', 'return.xml')).toBe(false);
  });

  it('honours * and ? wildcards', () => {
    expect(matchesPattern('return-2026Q1.xml', 'return-*.xml')).toBe(true);
    expect(matchesPattern('journal.csv', '*.csv')).toBe(true);
    expect(matchesPattern('q1.md', 'q?.md')).toBe(true);
    expect(matchesPattern('q11.md', 'q?.md')).toBe(false);
  });

  it('anchors the pattern — a suffix match is not a match', () => {
    expect(matchesPattern('draft-return.xml', 'return*')).toBe(false);
  });
});

const file = (
  title: string,
  patch: { at?: number; produced?: boolean; folderId?: string } = {},
) => ({
  title,
  _creationTime: patch.at ?? 1,
  folderId: patch.folderId ?? 'q1',
  ...(patch.produced !== false ? { sourceProvider: 'agent' } : {}),
});

describe('splitFolderFiles — declared deliverables', () => {
  const contract = {
    outcome: { files: ['return.xml', 'report.md', 'journal.csv'] },
  };

  it('promotes the declared files in the declared order, whatever the folder order', () => {
    const { outcome, rest } = splitFolderFiles(
      [
        file('journal.csv', { at: 3 }),
        file('scan-1.ocr.json', { at: 2 }),
        file('return.xml', { at: 4 }),
        file('sales.csv', { at: 1, produced: false }),
        file('report.md', { at: 5 }),
      ],
      'q1',
      contract,
    );
    expect(outcome.map((slot) => slot.label)).toEqual([
      'return.xml',
      'report.md',
      'journal.csv',
    ]);
    // `rest` comes back in preview order: the operator's own upload first.
    expect(rest.map((f) => f.title)).toEqual(['sales.csv', 'scan-1.ocr.json']);
  });

  it('keeps a promised slot for a deliverable no run has filed yet', () => {
    const { outcome } = splitFolderFiles([file('return.xml')], 'q1', contract);
    expect(outcome.map((slot) => [slot.label, slot.file !== null])).toEqual([
      ['return.xml', true],
      ['report.md', false],
      ['journal.csv', false],
    ]);
  });

  it('leaves the rest under Files — working material is never hidden', () => {
    const { rest } = splitFolderFiles(
      [file('a.ocr.json'), file('b.ocr.json'), file('return.xml')],
      'q1',
      contract,
    );
    expect(rest.map((f) => f.title)).toEqual(['a.ocr.json', 'b.ocr.json']);
  });

  it('promotes the newest file answering one pattern', () => {
    const { outcome } = splitFolderFiles(
      [
        file('return-old.xml', { at: 1 }),
        file('return-new.xml', { at: 9 }),
        file('report.md'),
        file('journal.csv'),
      ],
      'q1',
      { outcome: { files: ['return-*.xml'] } },
    );
    expect(outcome[0]?.label).toBe('return-new.xml');
  });

  it('ignores files outside the bound folder', () => {
    const { outcome, rest } = splitFolderFiles(
      [file('return.xml', { folderId: 'q2' }), file('sales.csv')],
      'q1',
      contract,
    );
    expect(outcome[0]).toEqual({ label: 'return.xml', file: null });
    expect(rest.map((f) => f.title)).toEqual(['sales.csv']);
  });
});

describe('splitFolderFiles — no declaration', () => {
  it('falls back to provenance, newest first', () => {
    const { outcome, rest } = splitFolderFiles(
      [
        file('scan.ocr.json', { at: 2 }),
        file('sales.csv', { at: 1, produced: false }),
        file('return.xml', { at: 3 }),
      ],
      'q1',
      null,
    );
    expect(outcome.map((slot) => slot.label)).toEqual([
      'return.xml',
      'scan.ocr.json',
    ]);
    expect(rest.map((f) => f.title)).toEqual(['sales.csv']);
  });

  it('has no outcome when nothing was produced', () => {
    const { outcome, rest } = splitFolderFiles(
      [file('sales.csv', { produced: false })],
      'q1',
      { outcome: undefined },
    );
    expect(outcome).toEqual([]);
    expect(rest).toHaveLength(1);
  });
});
