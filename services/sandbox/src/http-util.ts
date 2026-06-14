// Shared HTTP helpers for the spawner's route handlers. Extracted verbatim
// from server.ts when the session routes landed (sessions plan, milestone A)
// so /v1/execute and /v1/sessions/* share one body-cap + JSON-response
// implementation. Behavior is covered by server.test.ts.

export async function readBodyCapped(
  req: Request,
  maxBytes: number,
): Promise<string> {
  // Streaming guard so an unbounded POST can't OOM the process before we
  // ever see HMAC. We rely on the Content-Length hint when present and
  // hard-cap the actual byte count regardless.
  const cl = req.headers.get('content-length');
  if (cl !== null) {
    const declared = Number(cl);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw Object.assign(new Error('payload_too_large'), { httpStatus: 413 });
    }
  }
  const reader = req.body?.getReader();
  if (!reader) {
    return '';
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch((err) => {
          console.warn('[sandbox] reader cancel after body cap failed:', err);
        });
        throw Object.assign(new Error('payload_too_large'), {
          httpStatus: 413,
        });
      }
      chunks.push(value);
    }
  }
  const first = chunks[0];
  return new TextDecoder('utf-8').decode(
    chunks.length === 1 && first ? first : concat(chunks, total),
  );
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
  });
}
