// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { attestReplacementBytes } from './replacement.ts';
import { DocumentError } from './service.ts';

/**
 * The replacement door's attestation refusal. The core attester throws the
 * runtime-neutral `AppError`, which the document routes never mapped: a
 * mismatched file (or, before the attester learned them, any `.md`/`.json`/
 * `.yaml` controlled record) surfaced as Internal Server Error and an error
 * report per attempt, while the client waits for a coded 400
 * (`record.replace.contentMismatch`). This seam is where the two vocabularies
 * meet.
 */
describe('attestReplacementBytes', () => {
  const encoder = new TextEncoder();

  it('answers the attested MIME for bytes that match the extension', async () => {
    await expect(
      attestReplacementBytes(encoder.encode('# notes\n'), 'notes.md'),
    ).resolves.toBe('text/markdown');
  });

  it('refuses a mismatch as the coded 400 the door maps', async () => {
    const refused = await attestReplacementBytes(
      encoder.encode('not a PDF'),
      'spoofed.pdf',
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(DocumentError);
    if (!(refused instanceof DocumentError)) throw new Error('unreachable');
    expect(refused.code).toBe('UPLOAD_MIME_MISMATCH');
    expect(refused.status).toBe(400);
    expect(refused.data).toEqual({ reasonCode: 'mime_mismatch' });
    // A human sentence for `last_error`, never the serialized payload.
    expect(refused.message).not.toContain('{');
  });
});
