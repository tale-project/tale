/**
 * `contentBase64` is a wire-only field. `emailAttachmentMetaValidator` is a
 * strict object, so an attachment that still carries it is REJECTED at the
 * message mutation — and the metadata records, which are untyped JSON, would
 * silently swell by the whole attachment instead. Every ingest sink runs its
 * attachments through this helper first.
 */

import { describe, expect, it } from 'vitest';

import { attachmentsForMetadata } from './attachments_for_metadata';

const ATTACHMENT = {
  id: 'cv',
  filename: 'CV.pdf',
  contentType: 'application/pdf',
  size: 3,
  contentId: 'cid@x',
  storageId: 'storage-1',
  url: 'https://example.test/storage/storage-1/CV.pdf',
};

describe('attachmentsForMetadata', () => {
  it('drops contentBase64 and keeps every persisted field', () => {
    const out = attachmentsForMetadata([
      { ...ATTACHMENT, contentBase64: 'JVBERi0=' },
    ]);

    expect(out).toEqual([ATTACHMENT]);
    expect(out?.[0]).not.toHaveProperty('contentBase64');
  });

  it('leaves metadata-only attachments untouched', () => {
    const meta = {
      id: 'a',
      filename: 'a.txt',
      contentType: 'text/plain',
      size: 1,
    };
    expect(attachmentsForMetadata([meta])).toEqual([meta]);
  });

  it('passes undefined through so callers can stay optional', () => {
    expect(attachmentsForMetadata(undefined)).toBeUndefined();
  });
});
