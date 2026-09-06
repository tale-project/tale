/**
 * Sanitize attacker-controlled short text before interpolating it into the
 * user-role message body (video title, uploader name, etc). Strips control
 * chars (newlines, carriage returns, NUL), zero-width / bidi-override
 * marks that LLM tokenizers see but humans don't, and clamps length so a
 * 10 KB "title" can't blow up the prompt window.
 *
 * Lives in `lib/shared/` because both server (`buildMessageWithAttachments`
 * in start_agent_chat.ts) and client (optimistic-render formatter in
 * `video-link-markdown.ts`) need byte-identical output. The wrapping side
 * (`wrapUntrusted` / `UNTRUSTED_CONTENT_SYSTEM_PROMPT`) lives in
 * `lib/chat/untrusted-content.ts`.
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
