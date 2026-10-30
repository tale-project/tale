/**
 * The largest request body `/api/forms/submit` reads, in bytes. It must hold
 * every submission the schemas in `./schemas` accept. They count characters in
 * UTF-16 units, and a typed character takes at most three UTF-8 bytes per unit,
 * so a demo request with every field at its maximum, its text in a three-byte
 * script such as Japanese, comes to about 20 KB.
 */
export const MAX_SUBMIT_BODY_BYTES = 32 * 1024;

/**
 * Reads a submission's body, or answers `null` when it is over
 * `MAX_SUBMIT_BODY_BYTES`: first by its declared length, then by the bytes that
 * arrived, for a body sent without one.
 */
export async function readSubmitBody(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_SUBMIT_BODY_BYTES) return null;
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_SUBMIT_BODY_BYTES) return null;
  return new TextDecoder().decode(body);
}
