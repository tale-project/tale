// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attestReplacementFile } from './replacement.ts';
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
describe('attestReplacementFile', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'attest-replacement-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  /** A staged file holding `text`, as the door reads one from the disk. */
  const staged = (name: string, text: string): string => {
    const filePath = path.join(dir, name);
    writeFileSync(filePath, text);
    return filePath;
  };

  it('answers the attested MIME for bytes that match the extension', async () => {
    await expect(
      attestReplacementFile(staged('a', '# notes\n'), 'notes.md'),
    ).resolves.toBe('text/markdown');
  });

  it('refuses a mismatch as the coded 400 the door maps', async () => {
    const refused = await attestReplacementFile(
      staged('b', 'not a PDF'),
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
