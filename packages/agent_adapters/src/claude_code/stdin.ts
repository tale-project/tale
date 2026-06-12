// NDJSON lines for Claude Code `--input-format stream-json` stdin.
//
// Single source for the line shape so the adapter (initial prompt) and the
// platform steer delivery (mid-run pushes) can't drift. Verified on 2.1.173:
// the CLI accepts {type:"user", message:{role, content:[{type:"text",…}]}}
// lines; a malformed line exits the whole process (runnerd re-validates).

/** Mirrors the tale-steer-hook payload cap so one steer batch can never blow
 * the runnerd stdin line cap (64 KB) after JSON + base64 overhead. */
export const STEER_STDIN_TEXT_CAP = 16_000;

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
  return buildStdinUserMessage(payload.slice(0, STEER_STDIN_TEXT_CAP));
}
