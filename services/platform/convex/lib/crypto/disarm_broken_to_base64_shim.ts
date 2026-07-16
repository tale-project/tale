/**
 * jose 6 prefers `Uint8Array.prototype.toBase64` when present and passes
 * `{ alphabet: 'base64url', omitPadding: true }`. A process-global shim that
 * ignores those options (the pdfjs Node polyfill regression) makes
 * CompactEncrypt emit std-base64 JWE that compactDecrypt rejects.
 *
 * Drop a broken shim so jose falls back to encodeBase64 + url rewrite.
 * Correct native / options-aware shims are left alone.
 */
export function disarmBrokenToBase64Shim(): void {
  if (typeof Uint8Array.prototype.toBase64 !== 'function') return;
  try {
    const probe = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01]);
    const out = (
      Uint8Array.prototype.toBase64 as (options?: {
        alphabet?: 'base64' | 'base64url';
        omitPadding?: boolean;
      }) => string
    ).call(probe, { alphabet: 'base64url', omitPadding: true });
    if (!/[+=/]/.test(out)) return;
  } catch {
    // Treat a throwing shim as broken too.
  }
  // oxlint-disable-next-line no-extend-native -- removing a poison prototype shim so jose can use its safe fallback
  Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
}
