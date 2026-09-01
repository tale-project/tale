/**
 * Decode a base64url string (RFC 4648 §5 — `-`/`_` instead of `+`/`/`, no
 * required padding) into bytes, without depending on Node's `Buffer`.
 */
import { base64ToBytes } from './base64_to_bytes';

export function base64UrlToBuffer(input: string): Uint8Array {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) base64 += '='.repeat(4 - pad);
  return base64ToBytes(base64);
}
