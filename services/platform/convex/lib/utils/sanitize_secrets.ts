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
  // Authorization redaction must consume the rest of the line, not just the
  // scheme word. `\S+` only matches the scheme on multi-token schemes like
  // `Authorization: ApiKey <token>` and leaves the token exposed.
  /Authorization:[^\r\n]*/gi,
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /x-api-key:\s*\S+/gi,
  // Cookie / Set-Cookie lines often carry session tokens; redact the entire
  // header line value. Better Auth and most session libraries land here.
  /(?:Set-)?Cookie:[^\r\n]*/gi,
  // Better Auth session cookies even when they appear bare (no Cookie
  // header prefix), e.g. when a server stringifies the cookie jar.
  /(?:__Secure-|__Host-)?better-auth\.[a-z_]*session[a-z_]*=[^;\s]+/gi,
  // URL-embedded credentials: `https://user:pass@host/...`.
  /(\bhttps?:\/\/)[^\s:/?#]+:[^\s@]+@/gi,
  // Vendor-specific key prefixes. Patterns are anchored on the prefix to
  // avoid mis-redacting unrelated text.
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  // Stripe (live + test + restricted), with both `sk_` and `pk_` and `rk_`
  // prefixes. Underscore-separated, distinct from OpenAI's hyphenated `sk-`.
  /\b[sprk]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // OpenAI org/project identifiers as bare tokens (no surrounding scheme).
  /\borg-[A-Za-z0-9]{20,}/g,
  /\bproj_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{10,}/g,
  /\bxox[abprs]-[0-9A-Za-z-]{10,}/g,
  /\bgh[psorw]_[A-Za-z0-9]{20,}/g,
  // GitHub fine-grained PATs (separate prefix from classic ghp_/ghs_/etc).
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  // Convex deploy keys, e.g. `convex_dev_…` / `convex_prod_…`.
  /\bconvex_[a-z]+_[A-Za-z0-9_-]{20,}/g,
  // JWTs: three dot-separated base64url segments. Length floor guards
  // against accidentally matching version strings like `1.2.3`.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // Query-string secrets — common keys carrying a credential in the URL.
  // Expanded beyond the original short list (api_key|token|secret|signature
  // |sig) to cover the OAuth/auth-flow keys commonly seen in safe-fetch
  // redirect-loop logs.
  /([?&](?:api[_-]?key|token|secret|signature|sig|password|passwd|pwd|access_token|refresh_token|client_secret|auth)=)[^&\s]+/gi,
  // JSON body fields carrying credentials. Preserve the key for forensic
  // value while redacting the value. Value class honours backslash-escaped
  // characters so an inner `\"` (a literal quote inside the string)
  // doesn't terminate the match early and leak the rest of the JSON.
  /("(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
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
      // Preserve the JSON key for the same reason.
      const jsonPrefix = match.match(/^("(?:[^"\\]|\\.)+"\s*:\s*)/);
      if (jsonPrefix) return `${jsonPrefix[1]}"${REDACTED}"`;
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
