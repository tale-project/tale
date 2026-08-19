/**
 * Record which conversation an email's stored attachments arrived on.
 *
 * ## Why this is a second pass
 *
 * Attachment bytes are drained per message inside `sync_mailbox.fetchBodies`,
 * one body at a time, so a page of mail never holds every base64 payload at
 * once. That happens BEFORE the conversation is resolved, so at storage time
 * there is no conversation id to write. The binding therefore lands after
 * ingest, keyed on the `storageId` the materializer already put on the wire
 * attachment.
 *
 * ## Why bind at all
 *
 * The bytes were stored with no record of what they arrived on. Nothing
 * downstream could get from a file back to its mail, which is why an inbound
 * attachment could not be given a visibility rule, could not be reached by
 * retention, and could not be recognised as one already seen.
 *
 * The visibility rule is the reason it matters most: an emailed file should be
 * readable by whoever can currently read its conversation. Deriving that needs a
 * link. Stamping a team on the file instead would be wrong the moment somebody
 * reassigns the conversation, and every missed rewrite would leave a file either
 * hidden from its new owner or visible to its old one.
 *
 * Best-effort by design. A failed binding must not fail a sync that has already
 * ingested the mail — the attachment is still stored and still shown; it is the
 * link that is missing, and the next poll rebinds it.
 */

import { isRecord } from '../../../lib/utils/type-utils';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import type { EmailType } from './types';

/** One ingested email and the conversation it landed on. */
export interface AttachmentBinding {
  readonly email: EmailType;
  readonly conversationId: Id<'conversations'>;
}

/** The stored blob refs an ingested email carries. A part with no `storageId`
 *  was never materialized (metadata-only chip), so there is no row to bind. */
function storedRefs(email: EmailType): string[] {
  const refs: string[] = [];
  for (const attachment of email.attachments ?? []) {
    if (!isRecord(attachment)) continue;
    const storageId = attachment.storageId;
    if (typeof storageId === 'string' && storageId !== '') refs.push(storageId);
  }
  return refs;
}

export async function bindEmailAttachments(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    bindings: readonly AttachmentBinding[];
  },
): Promise<void> {
  for (const { email, conversationId } of args.bindings) {
    for (const storageId of storedRefs(email)) {
      try {
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.bindFileToConversation,
          {
            organizationId: args.organizationId,
            storageId,
            conversationId,
          },
        );
      } catch (error) {
        // Never fail an ingest that already landed the mail.
        console.warn(
          `[bindEmailAttachments] could not bind ${storageId} to ${String(conversationId)}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}
