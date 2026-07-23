/**
 * Work around a broken `Uint8Array.prototype.toBase64` polyfill.
 *
 * jose 6 prefers the native/polyfilled `toBase64` when it's present and
 * calls it with `{ alphabet: 'base64url', omitPadding: true }`. A stray
 * process-global shim that ignores those options (seen from a pdfjs Node
 * polyfill regression) then makes `CompactEncrypt` emit standard-base64
 * JWE segments that `compactDecrypt` refuses to parse.
 *
 * Probe the installed shim and delete it if it can't honor the options
 * jose passes, so jose falls back to its own safe base64url encoding.
 * A correct, options-aware shim (or the real native implementation) is
 * left untouched.
 */
export function disarmBrokenToBase64Shim(): void {
  const toBase64 = Reflect.get(Uint8Array.prototype, 'toBase64');
  if (typeof toBase64 !== 'function') return;
  try {
    const probe = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01]);
    const out = Reflect.apply(toBase64, probe, [
      { alphabet: 'base64url', omitPadding: true },
    ]);
    if (typeof out === 'string' && !/[+=/]/.test(out)) return;
  } catch {
    // A shim that throws on the options form is broken too — fall through
    // and remove it.
  }
  // oxlint-disable-next-line no-extend-native -- deliberately removing a poisoned prototype shim so jose's safe fallback applies
  Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
}
