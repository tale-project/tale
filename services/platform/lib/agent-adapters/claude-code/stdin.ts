// NDJSON lines for Claude Code `--input-format stream-json` stdin.
//
// Single source for the line shape so the adapter (initial prompt) and the
// platform steer delivery (mid-run pushes) can't drift. Verified on 2.1.173:
// the CLI accepts {type:"user", message:{role, content:[{type:"text",…}]}}
// lines; a malformed line exits the whole process (runnerd re-validates).

/** Max UTF-8 BYTES of steer text per batch. Mirrors the tale-steer-hook payload
 * cap so one steer batch can never blow the runnerd stdin line cap (64 KB) after
 * JSON + base64 overhead. Must be a BYTE budget (not a char count): the line is
 * gated by RUNNERD_STDIN_MAX_BYTES on its decoded byte length, so a char-count
 * cap would let a multibyte (CJK/emoji) batch silently exceed it and be rejected
 * as BAD_LINE. 16 KB leaves ample headroom for the JSON envelope + escaping. */
export const STEER_STDIN_TEXT_CAP = 16_000;

/** Truncate `text` to at most `maxBytes` UTF-8 bytes WITHOUT splitting a
 * codepoint (a half-emoji would corrupt the JSON line). Backs off past any
 * trailing continuation bytes (0b10xxxxxx) to the last whole codepoint. */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // If we'd cut mid-sequence, walk back to the start of that codepoint.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** One newline-terminated stream-json user message. */
export function buildStdinUserMessage(text: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  })}\n`;
}

/** A steer batch as one stdin user message, wrapped in the same
 * `[TALE_STEER ids=...]` sentinel the in-image hook emits — the platform's
 * parser flips the queue rows to consumed when the sentinel surfaces in the
 * conversation, regardless of which channel delivered it. */
export function buildSteerStdinPayload(
  rows: Array<{ messageId: string; text: string }>,
): string {
  const ids = rows.map((r) => r.messageId).join(',');
  const body = rows.map((r) => r.text).join('\n\n');
  const payload =
    `[TALE_STEER ids=${ids}] The user sent the following message(s) while you were working. ` +
    `Adjust your current work to incorporate them now:\n\n${body}`;
  return buildStdinUserMessage(
    truncateToUtf8Bytes(payload, STEER_STDIN_TEXT_CAP),
  );
}
