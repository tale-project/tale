import { describe, expect, it, vi } from 'vitest';

import { ExtractionError } from './errors.ts';
import { extractTextFromTextBytes } from './text.ts';

/**
 * Binary bytes behind a text extension used to decode as Latin-1 garbage —
 * NUL included — that the corpus refused after the embedding was paid for
 * (2026-09-14 evaluation, g3-2). They are refused up front, terminal; a
 * legacy single-byte encoding is still text and still falls back.
 */
describe('extractTextFromTextBytes', () => {
  it('decodes UTF-8 as is', async () => {
    const [text, vision] = await extractTextFromTextBytes(
      new TextEncoder().encode('Grüße — café'),
    );
    expect(text).toBe('Grüße — café');
    expect(vision).toBe(false);
  });

  it('falls back to Latin-1 for a legacy encoding without a NUL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [text] = await extractTextFromTextBytes(
      Uint8Array.from([0x47, 0x72, 0xfc, 0xdf, 0x65]),
      'legacy.txt',
    );
    expect(text).toBe('Grüße');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('refuses binary bytes as a terminal not_text extraction error', async () => {
    const bytes = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0xff]);
    await expect(extractTextFromTextBytes(bytes, 'tool.txt')).rejects.toThrow(
      ExtractionError,
    );
    await expect(
      extractTextFromTextBytes(bytes, 'tool.txt'),
    ).rejects.toMatchObject({
      code: 'not_text',
      message: expect.stringContaining('"tool.txt"'),
    });
  });
});
