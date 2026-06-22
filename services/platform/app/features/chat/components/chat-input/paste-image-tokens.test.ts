import { describe, expect, it } from 'vitest';

import {
  buildMarkerToken,
  collapseMarkerSpaces,
  isPastedImageRef,
  MARKER_RESERVE_SPACES,
  nextPasteImageId,
  pastedImageIdFromName,
  presentTokenIds,
  tokenSpans,
} from './paste-image-tokens';

describe('pastedImageIdFromName', () => {
  it('reads the id from a pasted-image file name', () => {
    expect(pastedImageIdFromName('[1].png')).toBe(1);
    expect(pastedImageIdFromName('[12].jpg')).toBe(12);
  });

  it('reads the id from the upload-tracking id (name + suffix)', () => {
    // `useConvexFileUpload` keys in-flight uploads as `${file.name}-${ts}`.
    expect(pastedImageIdFromName('[3].png-1718900000000')).toBe(3);
  });

  it('returns null for names that are not pasted images', () => {
    expect(pastedImageIdFromName('report.pdf')).toBeNull();
    expect(pastedImageIdFromName('pasted-image-2026.png')).toBeNull();
    expect(pastedImageIdFromName('[abc].png')).toBeNull();
    expect(pastedImageIdFromName('[1]')).toBeNull(); // no extension
  });
});

describe('isPastedImageRef', () => {
  it('matches pasted-image names and upload ids', () => {
    expect(isPastedImageRef('[1].png')).toBe(true);
    expect(isPastedImageRef('[7].jpeg-99')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isPastedImageRef('notes.txt')).toBe(false);
    expect(isPastedImageRef('[x].png')).toBe(false);
    expect(isPastedImageRef('image[1].png')).toBe(false);
  });
});

describe('presentTokenIds', () => {
  it('collects every distinct [N] id in the text', () => {
    expect([...presentTokenIds('compare [1] with [2] and [2]')]).toEqual([
      1, 2,
    ]);
  });

  it('handles multi-digit ids and no tokens', () => {
    expect([...presentTokenIds('[10] vs [3]')].sort((a, b) => a - b)).toEqual([
      3, 10,
    ]);
    expect(presentTokenIds('no tokens here').size).toBe(0);
    expect(presentTokenIds('').size).toBe(0);
  });
});

describe('nextPasteImageId', () => {
  it('starts at 1 for empty / token-free text', () => {
    expect(nextPasteImageId('')).toBe(1);
    expect(nextPasteImageId('hello world')).toBe(1);
  });

  it('is one past the highest existing token (not the count)', () => {
    expect(nextPasteImageId('here [1] is one')).toBe(2);
    expect(nextPasteImageId('[1] [5] [3]')).toBe(6);
  });

  it('avoids colliding with a token the user typed', () => {
    expect(nextPasteImageId('see footnote [9]')).toBe(10);
  });

  it('parses zero-padded ids by value', () => {
    expect(nextPasteImageId('[007]')).toBe(8);
  });
});

describe('tokenSpans', () => {
  it('returns the char range of each token', () => {
    expect(tokenSpans('a [1] b [22]')).toEqual([
      { id: 1, start: 2, end: 5 },
      { id: 22, start: 8, end: 12 },
    ]);
  });

  it('is empty when there are no tokens', () => {
    expect(tokenSpans('no tokens')).toEqual([]);
  });

  it('locates a token so a caret right after it can be matched (atomic delete)', () => {
    const value = 'hi [3] there';
    const [span] = tokenSpans(value);
    // The slice covers exactly `[3]` — Backspace at `span.end` removes the
    // whole token rather than just the trailing `]`.
    expect(value.slice(span.start, span.end)).toBe('[3]');
  });
});

describe('buildMarkerToken', () => {
  it('is `[N]` followed by the reserve spaces (room for the rectangle badge)', () => {
    const token = buildMarkerToken(2);
    expect(token).toBe(`[2]${' '.repeat(MARKER_RESERVE_SPACES)}`);
    expect(token.startsWith('[2]')).toBe(true);
    expect(token.length).toBe(3 + MARKER_RESERVE_SPACES);
  });
});

describe('collapseMarkerSpaces', () => {
  it('collapses the reserve spaces after each token to one (outgoing text)', () => {
    expect(collapseMarkerSpaces('compare [1]      with [2]      please')).toBe(
      'compare [1] with [2] please',
    );
  });

  it('leaves ordinary spacing untouched', () => {
    expect(collapseMarkerSpaces('no markers here')).toBe('no markers here');
    expect(collapseMarkerSpaces('[1] ')).toBe('[1] ');
  });
});
