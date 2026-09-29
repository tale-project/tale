/**
 * Sanitize attacker-controlled short text before interpolating it into the
 * user-role message body (video title, uploader name, a skill's description,
 * etc). Strips control chars (newlines, carriage returns, NUL), zero-width /
 * bidi-override marks that LLM tokenizers see but humans don't, and clamps
 * length so a 10 KB "title" can't blow up the prompt window.
 *
 * The clamp counts user-perceived characters (grapheme clusters), so a cut
 * never leaves half an emoji, a lone surrogate, or a stray combining mark
 * behind; a clamped result is at most `maxLen` characters including its
 * trailing ellipsis.
 *
 * Lives in `lib/shared/` as the runtime-agnostic boundary helper; the
 * backend reaches it through `lib/chat/untrusted-content` (the video-link
 * ingest's metadata trust boundary, the assistant tools' titles), which
 * remains the home for `wrapUntrusted` / `UNTRUSTED_CONTENT_SYSTEM_PROMPT`.
 */
export function sanitizeUntrustedField(value: string, maxLen = 200): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/[​-‏‪-‮⁠⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A string never holds more grapheme clusters than UTF-16 code units, so a
  // short one needs no segmenting.
  if (stripped.length <= maxLen) return stripped;
  const characters = Array.from(
    graphemeSegmenter().segment(stripped),
    (part) => part.segment,
  );
  if (characters.length <= maxLen) return stripped;
  return `${characters
    .slice(0, Math.max(maxLen - 1, 0))
    .join('')
    .trimEnd()}…`;
}

let segmenter: Intl.Segmenter | undefined;

function graphemeSegmenter(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter;
}
