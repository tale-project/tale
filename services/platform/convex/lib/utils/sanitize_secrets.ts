/**
 * Redact common secret patterns from error messages before they reach
 * persisted rows, client subscribers, or server logs. The original
 * `sanitizeTtsError` only covered Bearer / `sk-` / `Authorization:` — this
 * module extends the bank to cover Basic auth, URL-embedded creds, and the
 * most common cloud / SaaS API-key shapes.
 *
 * Apply order matters: redact FIRST, then truncate. Truncating before
 * redaction can leave a secret tail exposed when the secret straddles the
 * slice boundary.
 */

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // HTTP Authorization variants. The bearer-token regex deliberately covers
  // the full URL-safe token alphabet so JWT-shaped tokens are caught too.
  /Bearer\s+[A-Za-z0-9._\-~+/=]+/gi,
  /Authorization:\s*\S+/gi,
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /x-api-key:\s*\S+/gi,
  // URL-embedded credentials: `https://user:pass@host/...`.
  /(\bhttps?:\/\/)[^\s:/?#]+:[^\s@]+@/gi,
  // Vendor-specific key prefixes. Patterns are anchored on the prefix to
  // avoid mis-redacting unrelated text.
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}/g,
  /\bgh[psorw]_[A-Za-z0-9]{20,}/g,
  // JWTs: three dot-separated base64url segments. Length floor guards
  // against accidentally matching version strings like `1.2.3`.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Query-string secrets — common keys carrying a credential in the URL.
  /([?&](?:api[_-]?key|token|secret|signature|sig)=)[^&\s]+/gi,
];

const REDACTED = '[REDACTED]';
const DEFAULT_MAX_LEN = 200;

function applyRedactors(input: string): string {
  let output = input;
  for (const pattern of SECRET_PATTERNS) {
    // Reset state on shared `/g` regex instances — each new caller starts
    // from index 0. (We construct fresh literals above, but defending here
    // keeps the helper safe under future inlining.)
    pattern.lastIndex = 0;
    output = output.replace(pattern, (match) => {
      // Preserve the prefix for query-string redactions so logs still hint
      // at *which* secret was scrubbed.
      const queryPrefix = match.match(/^([?&][^=]+=)/);
      if (queryPrefix) return `${queryPrefix[1]}${REDACTED}`;
      return REDACTED;
    });
  }
  return output;
}

/**
 * Redact and truncate an error for safe logging or storage. `maxLen`
 * defaults to 200 chars — enough for human triage, short enough that a
 * verbose provider error can't bloat a row or log line.
 */
export function sanitizeError(
  err: unknown,
  maxLen: number = DEFAULT_MAX_LEN,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const redacted = applyRedactors(raw);
  if (redacted.length <= maxLen) return redacted;
  return `${redacted.slice(0, maxLen)}…`;
}
