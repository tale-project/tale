import { describe, expect, it } from 'vitest';

import { isAuthoredSourceProvider } from './document-source-providers';

describe('isAuthoredSourceProvider', () => {
  // 'upload' is a member's file, 'agent' one an automation wrote into the
  // folder (a reading, a generated report); an absent provider reads as an
  // upload, as the document view defaults it.
  it.each(['upload', 'agent', undefined, null, ''])(
    'reads %j as authored here',
    (provider) => {
      expect(isAuthoredSourceProvider(provider)).toBe(true);
    },
  );

  it.each(['onedrive', 'google_drive', 'sharepoint', 'confluence', 'webdav'])(
    'reads the connector slug %j as owned by its external sync',
    (provider) => {
      expect(isAuthoredSourceProvider(provider)).toBe(false);
    },
  );
});
