import { describe, expect, it } from 'vitest';

import { isGoogleWorkspaceMime } from './list_files';

describe('isGoogleWorkspaceMime', () => {
  it('treats native Docs/Sheets as non-binary', () => {
    expect(isGoogleWorkspaceMime('application/vnd.google-apps.document')).toBe(
      true,
    );
    expect(
      isGoogleWorkspaceMime('application/vnd.google-apps.spreadsheet'),
    ).toBe(true);
  });

  it('allows folders and ordinary files', () => {
    expect(isGoogleWorkspaceMime('application/vnd.google-apps.folder')).toBe(
      false,
    );
    expect(isGoogleWorkspaceMime('application/pdf')).toBe(false);
    expect(isGoogleWorkspaceMime(undefined)).toBe(false);
  });
});
