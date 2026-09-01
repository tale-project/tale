import { describe, expect, it } from 'vitest';

import { sourceFromProvider } from './source_from_provider';

describe('sourceFromProvider', () => {
  it("maps the document 'upload' provider to fileMetadata 'user'", () => {
    expect(sourceFromProvider('upload')).toBe('user');
  });

  it("returns undefined (leave unchanged) for 'agent' and missing provider", () => {
    expect(sourceFromProvider('agent')).toBeUndefined();
    expect(sourceFromProvider(undefined)).toBeUndefined();
    expect(sourceFromProvider('')).toBeUndefined();
  });

  it('records external-import connector slugs verbatim', () => {
    for (const slug of [
      'confluence',
      'google_drive',
      'onedrive',
      'sharepoint',
      'webdav',
      'some_custom_connector',
    ]) {
      expect(sourceFromProvider(slug)).toBe(slug);
    }
  });
});
