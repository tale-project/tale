/**
 * Whether an outbound email has something to send: a body, files, or both.
 * An empty body beside files is an attachment-only email — the composer
 * offers Send for one — while neither is no email at all.
 *
 * Shared by the app's send adapters, the reply and compose doors and the
 * send service, so all three read "empty" alike. A body is empty only when
 * it is `''`: the composer hands over `''` for a blank document, and every
 * body the doors took before attachment-only mail still passes.
 * `lib/` never imports `backend/`, hence the home here.
 */
export function hasBodyOrAttachments(email: {
  content: string;
  attachments?: readonly unknown[] | undefined;
}): boolean {
  return email.content !== '' || (email.attachments?.length ?? 0) > 0;
}
