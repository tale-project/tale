import { describe, expect, it } from 'vitest';

import {
  decodeWithEncoding,
  readBodyCapped,
  TEXT_PREVIEW_MAX_BYTES,
} from './use-document-preview';

/**
 * Regression guards for large-file text previews: the preview used to download
 * the ENTIRE file and render it in one block — a 96 MB text document froze the
 * tab. `readBodyCapped` must stop reading (and cancel the stream) once the cap
 * is crossed, and `decodeWithEncoding` must not mis-detect a UTF-8 file as
 * ISO-8859-1 just because the byte cap chopped a multibyte character.
 */

function streamResponse(chunks: Uint8Array[]): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(body);
}

describe('readBodyCapped', () => {
  it('reads a small body fully without marking it truncated', async () => {
    const payload = new TextEncoder().encode('hello world');
    const { bytes, truncated } = await readBodyCapped(
      streamResponse([payload]),
      TEXT_PREVIEW_MAX_BYTES,
    );
    expect(truncated).toBe(false);
    expect(new TextDecoder().decode(bytes)).toBe('hello world');
  });

  it('stops at the cap and cancels the rest of a large body', async () => {
    const chunk = new Uint8Array(512 * 1024).fill(65); // 'A'
    const res = streamResponse([chunk, chunk, chunk, chunk]); // 2 MiB total
    const { bytes, truncated } = await readBodyCapped(
      res,
      TEXT_PREVIEW_MAX_BYTES,
    );
    expect(truncated).toBe(true);
    expect(bytes.byteLength).toBe(TEXT_PREVIEW_MAX_BYTES);
  });

  it('is exact at the boundary: a body of exactly the cap is not truncated', async () => {
    const chunk = new Uint8Array(TEXT_PREVIEW_MAX_BYTES).fill(66);
    const { bytes, truncated } = await readBodyCapped(
      streamResponse([chunk]),
      TEXT_PREVIEW_MAX_BYTES,
    );
    expect(truncated).toBe(false);
    expect(bytes.byteLength).toBe(TEXT_PREVIEW_MAX_BYTES);
  });
});

describe('decodeWithEncoding with a chopped multibyte tail', () => {
  it('still detects UTF-8 when truncation split a character', () => {
    // 'ä€' = C3 A4 E2 82 AC — cut inside the euro sign (drop the last byte).
    const full = new TextEncoder().encode('Bestellung ä€');
    const chopped = full.subarray(0, full.byteLength - 1);

    const { text, encoding } = decodeWithEncoding(chopped, true);

    expect(encoding).toBe('utf-8');
    expect(text).toBe('Bestellung ä');
    expect(text.includes('�')).toBe(false);
  });

  it('decodes an untruncated buffer exactly as before', () => {
    const bytes = new TextEncoder().encode('plain ascii');
    const { text, encoding } = decodeWithEncoding(bytes);
    expect(encoding).toBe('utf-8');
    expect(text).toBe('plain ascii');
  });
});
