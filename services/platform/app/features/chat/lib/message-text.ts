/**
 * The plain text of a message — its text parts joined in authored order.
 *
 * This is what Copy puts on the clipboard and what the streaming reveal
 * renders. Non-text parts (attachments, tool calls, approvals) are surfaces
 * of their own and are deliberately not flattened in — copying an answer
 * should never paste `[attachment: report.pdf]` prose the model never wrote.
 */

import type { MessagePart } from '../types';

export function messagePlainText(parts: readonly MessagePart[]): string {
  const pieces: string[] = [];
  for (const part of parts) {
    if (part.type === 'text' && part.text.length > 0) {
      pieces.push(part.text);
    }
  }
  return pieces.join('\n\n');
}
