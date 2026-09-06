/**
 * The pure pieces of the reply path, shared by the 0.5 send surface
 * (`domains/conversations/send.ts`): the bulk cap, the `Re:`-prefixed
 * subject and the html/text body split.
 */

/** Subject used when the conversation itself has none. */
const FALLBACK_REPLY_SUBJECT = 'Re: Conversation';

/**
 * Upper bound for one bulk reply call — each reply performs several writes
 * and schedules an outbound send job, so the batch must stay small enough
 * for a single request.
 */
export const BULK_REPLY_CAP = 50;

/** `Re:`-prefix a subject exactly once (case-insensitive, idempotent). */
export function buildReplySubject(subject: string | undefined): string {
  const trimmed = subject?.trim();
  if (!trimmed) return FALLBACK_REPLY_SUBJECT;
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/** Split composer content into an html body and a tag-stripped text body. */
export function splitHtmlText(content: string): { html: string; text: string } {
  return { html: content, text: content.replace(/<[^>]*>/g, '') };
}
