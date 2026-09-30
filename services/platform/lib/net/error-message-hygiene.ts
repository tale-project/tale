/**
 * Runtime source locations that leak into error text — OpenSSL's
 * `HANDLE:error:CODE:` prefix and Node's `../deps/openssl/…/file.c:916`
 * path fragments on a TLS failure. A customer-facing row (a crawled page's
 * `lastError`) or a connector log carries the human clause, never the
 * toolchain's file and line (2026-09-14 evaluation, h5).
 */
export function stripRuntimeLocations(message: string): string {
  return (
    message
      .replace(/\b[0-9A-F]{16}:error:[0-9A-F]+:/gi, '')
      .replace(/\.\.\/deps\/[^\s:]+:\d+:?/g, '')
      // Doubled colons the removals leave behind — never Chromium's own
      // `net::ERR_…` namespace, which a reader searches for verbatim (a row
      // used to read `net:ERR_ABORTED`, 2026-09-30).
      .replace(/(?<!\bnet)::+/g, ':')
      .replace(/:\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}
