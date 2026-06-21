import { describe, expect, it } from 'vitest';

import { resolveColumnLabels, resolvePackLabel } from './app-runtime';

describe('resolvePackLabel', () => {
  const labels = {
    'issueDesk.deskTitle': 'Issue-Bearbeitung',
    'issueDesk.col.number': 'Nummer',
  };

  it('resolves a $label: marker against the catalog', () => {
    expect(resolvePackLabel('$label:issueDesk.deskTitle', labels)).toBe(
      'Issue-Bearbeitung',
    );
  });

  it('passes a plain literal through unchanged', () => {
    expect(resolvePackLabel('GitHub issues', labels)).toBe('GitHub issues');
  });

  it('falls back to the bare key when the marker is absent from the catalog', () => {
    expect(resolvePackLabel('$label:issueDesk.missing', labels)).toBe(
      'issueDesk.missing',
    );
  });

  it('returns undefined for an undefined value', () => {
    expect(resolvePackLabel(undefined, labels)).toBeUndefined();
  });
});

describe('resolveColumnLabels', () => {
  const resolve = (value: string | undefined) =>
    resolvePackLabel(value, { 'issueDesk.col.number': 'Nummer' });

  it('resolves each entry, leaving the column keys intact', () => {
    expect(
      resolveColumnLabels(
        {
          number: '$label:issueDesk.col.number',
          title: '$label:issueDesk.col.title', // missing → bare key fallback
          state: 'State', // literal passthrough
        },
        resolve,
      ),
    ).toEqual({
      number: 'Nummer',
      title: 'issueDesk.col.title',
      state: 'State',
    });
  });

  it('returns undefined when there is no map to resolve', () => {
    expect(resolveColumnLabels(undefined, resolve)).toBeUndefined();
  });
});
