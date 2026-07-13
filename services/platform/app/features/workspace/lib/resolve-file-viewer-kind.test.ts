import { describe, expect, it } from 'vitest';

import { resolveFileViewerKind } from './resolve-file-viewer-kind';

describe('resolveFileViewerKind', () => {
  it('infers markdown for uploaded paths when renderHint is unset', () => {
    expect(
      resolveFileViewerKind(
        undefined,
        '/user/uploads/notes.md',
        'text/markdown',
      ),
    ).toBe('markdown');
  });

  it('infers code for text uploads when renderHint is unset', () => {
    expect(
      resolveFileViewerKind(
        undefined,
        '/user/uploads/script.py',
        'text/x-python',
      ),
    ).toBe('code');
  });

  it('forces download-only when renderHint is attachment', () => {
    expect(
      resolveFileViewerKind(
        'attachment',
        '/user/uploads/notes.md',
        'text/markdown',
      ),
    ).toBe('attachment');
  });

  it('keeps image hint for image uploads', () => {
    expect(
      resolveFileViewerKind('image', '/user/uploads/photo.png', 'image/png'),
    ).toBe('image');
  });
});
