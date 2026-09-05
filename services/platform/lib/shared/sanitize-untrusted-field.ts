/**
 * Sanitize attacker-controlled short text before interpolating it into the
 * user-role message body (video title, uploader name, etc). Strips control
 * chars (newlines, carriage returns, NUL), zero-width / bidi-override
 * marks that LLM tokenizers see but humans don't, and clamps length so a
 * 10 KB "title" can't blow up the prompt window.
 *
 * Lives in `lib/shared/` as the runtime-agnostic boundary helper; the
 * backend reaches it through `lib/chat/untrusted-content` (the video-link
 * ingest's metadata trust boundary, the assistant tools' titles), which
 * remains the home for `wrapUntrusted` / `UNTRUSTED_CONTENT_SYSTEM_PROMPT` /
 * `containsSuspiciousInjection`.
 */
export function sanitizeUntrustedField(value: string, maxLen = 200): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[​-‏‪-‮⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > maxLen ? stripped.slice(0, maxLen) + '…' : stripped;
}
