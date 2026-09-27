import { describe, expect, it } from 'vitest';

import { hasBodyOrAttachments } from './outbound-content';

const FILE = {
  storageId: 'blob-1',
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 1024,
};

describe('hasBodyOrAttachments', () => {
  it('takes a body alone', () => {
    expect(hasBodyOrAttachments({ content: '<p>On its way.</p>' })).toBe(true);
  });

  it('takes files with no body — an attachment-only email', () => {
    expect(hasBodyOrAttachments({ content: '', attachments: [FILE] })).toBe(
      true,
    );
  });

  it('takes a body with files', () => {
    expect(
      hasBodyOrAttachments({ content: 'See attached.', attachments: [FILE] }),
    ).toBe(true);
  });

  it('refuses neither a body nor a file', () => {
    expect(hasBodyOrAttachments({ content: '' })).toBe(false);
    expect(hasBodyOrAttachments({ content: '', attachments: [] })).toBe(false);
    expect(hasBodyOrAttachments({ content: '', attachments: undefined })).toBe(
      false,
    );
  });

  // The doors took any non-empty body before attachment-only mail; judging
  // whitespace as empty here would refuse a reply they used to send.
  it('keeps a body the doors already took', () => {
    expect(hasBodyOrAttachments({ content: ' ' })).toBe(true);
  });
});
