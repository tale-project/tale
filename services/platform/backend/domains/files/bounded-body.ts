import { FileError, MAX_UPLOAD_BYTES } from './service.ts';

/**
 * Bounded intake of an incoming byte stream — the guard every lane that
 * lands a caller- or vendor-supplied body into org storage reads through.
 *
 * Two gates, in order: the DECLARED length (`Content-Length`) is refused
 * before a single byte is read, and the ACTUAL bytes are counted as they
 * arrive and the read aborts the moment they pass the cap. The blob store's
 * own size check still runs afterwards, but it used to be the only one — a
 * multi-gigabyte download (or a chunked body with no declared length) was
 * buffered whole in the worker's heap before it could fire.
 */

export { MAX_UPLOAD_BYTES };

/** The declared body length, when the peer sent a usable one. */
export function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tooLarge(maxBytes: number, declared: number | null): FileError {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return new FileError(
    'FILE_SIZE_INVALID',
    declared === null
      ? `The file exceeds the ${mb} MB limit`
      : `The file is ${declared} bytes; the limit is ${mb} MB`,
    413,
  );
}

/**
 * Read a body into memory, refusing past `maxBytes`: first on the declared
 * length (nothing is read), then on the bytes actually received (the read
 * is cancelled at the first chunk past the cap, so at most one chunk beyond
 * the limit is ever held). Answers the bytes and the length the peer
 * declared, if any.
 */
export async function readBodyBounded(
  source: { headers: Headers; body: ReadableStream<Uint8Array> | null },
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = declaredContentLength(source.headers);
  if (declared !== null && declared > maxBytes) {
    // Refused unread: cancel the stream so the socket goes back too.
    await source.body?.cancel().catch((error: unknown) => {
      console.warn('[files] cancelling an oversized body failed:', error);
    });
    throw tooLarge(maxBytes, declared);
  }
  if (source.body === null) return new Uint8Array(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch((error: unknown) => {
          console.warn('[files] cancelling an oversized body failed:', error);
        });
        throw tooLarge(maxBytes, null);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 1 && chunks[0] !== undefined) return chunks[0];
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
