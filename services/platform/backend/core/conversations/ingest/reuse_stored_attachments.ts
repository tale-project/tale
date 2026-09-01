/**
 * Reuse the attachment pointers a message already has, instead of storing its
 * bytes a second time.
 *
 * A mail poll re-fetches messages it has already ingested — most reliably the
 * one sitting exactly on the sync cursor, which is derived from that message's
 * own timestamp and compared inclusively (see the boundary re-fetch issue). The
 * body arrives complete with `contentBase64` every time, and
 * `materializeEmailAttachments` would faithfully store it again: blob keys are
 * `randomUUID()` (`lib/storage/object_store.ts`), so identical bytes always get
 * a fresh object, and `saveFileMetadata` dedupes on `storageId`, so a fresh key
 * always means a fresh row. One attachment on a message that stays on the
 * cursor therefore accumulates one blob and one `fileMetadata` row per poll,
 * indefinitely.
 *
 * The bytes are immutable, so a message that already carries `storageId`s needs
 * nothing stored: handing back the pointers it already has makes the ingest
 * path's metadata rewrite a no-op for attachments and leaves the wire
 * `contentBase64` to be dropped as usual.
 *
 * Deliberately keyed on the message being ALREADY INGESTED rather than on the
 * bytes being familiar. Content-addressed storage would be the deeper fix, but
 * it changes every blob writer; this is the narrow one, and it cannot skip a
 * genuinely new attachment because a new message has nothing stored to reuse.
 */

import { isRecord } from '../../../../lib/utils/type-utils';
import type { ActionCtx } from '../../lib/ctx';
import { checkMessageExists } from './check_message_exists';

/** One stored attachment, as it sits in a message's metadata. */
interface StoredAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  storageId: string;
  url?: string;
}

/**
 * The attachments an already-ingested message holds, keyed by filename.
 *
 * Filename is the only identifier that survives the round trip: the wire `id`
 * is a per-fetch part handle (an IMAP part number), not stable across fetches,
 * while `storageId` is what we are trying to avoid re-minting. Two parts sharing
 * a filename collapse to one entry — harmless, since identical filenames on one
 * message carry identical bytes in every case this path is reached, and a
 * mismatch simply falls through to storing normally.
 */
function storedByFilename(metadata: unknown): Map<string, StoredAttachment> {
  const byName = new Map<string, StoredAttachment>();
  if (!isRecord(metadata) || !Array.isArray(metadata.attachments))
    return byName;
  for (const raw of metadata.attachments) {
    if (!isRecord(raw)) continue;
    const { filename, storageId } = raw;
    // No `storageId` means the bytes were never stored (a metadata-only chip
    // from before attachment storage shipped, or a failed materialization).
    // Those SHOULD be stored on this pass, so they are not reusable.
    if (typeof filename !== 'string' || typeof storageId !== 'string') continue;
    if (typeof raw.contentType !== 'string' || typeof raw.size !== 'number') {
      continue;
    }
    byName.set(filename, {
      id: typeof raw.id === 'string' ? raw.id : filename,
      filename,
      contentType: raw.contentType,
      size: raw.size,
      storageId,
      ...(typeof raw.contentId === 'string' && { contentId: raw.contentId }),
      ...(typeof raw.url === 'string' && { url: raw.url }),
    });
  }
  return byName;
}

/**
 * Swap each fetched email's attachments for the ones its already-ingested
 * message holds, and report which emails still need materializing.
 *
 * An email is returned untouched when it is new, when the existing message has
 * no usable stored attachment for a part, or when anything about the lookup is
 * unclear — the fallback is always "store it", so a missed reuse costs a
 * duplicate blob while a wrong reuse would cost a broken download link.
 */
export async function reuseStoredAttachments(
  ctx: ActionCtx,
  args: { organizationId: string; emails: readonly unknown[] },
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const email of args.emails) {
    if (
      !isRecord(email) ||
      !Array.isArray(email.attachments) ||
      email.attachments.length === 0 ||
      typeof email.messageId !== 'string'
    ) {
      out.push(email);
      continue;
    }

    let existing: Awaited<ReturnType<typeof checkMessageExists>> = null;
    try {
      existing = await checkMessageExists(
        ctx,
        args.organizationId,
        email.messageId,
      );
    } catch (error) {
      // A lookup failure must not lose the attachment: fall through and store
      // it, accepting a duplicate rather than dropping a file.
      console.warn(
        '[reuseStoredAttachments] existing-message lookup failed; storing normally',
        error instanceof Error ? error.message : String(error),
      );
      out.push(email);
      continue;
    }

    if (existing === null) {
      out.push(email);
      continue;
    }

    const stored = storedByFilename(existing.metadata);
    if (stored.size === 0) {
      out.push(email);
      continue;
    }

    // All-or-nothing per email: mixing reused and freshly stored parts would
    // make the "did anything change?" reasoning below much harder to trust for
    // no practical gain — a message either has its attachments stored or it
    // does not.
    const reused: StoredAttachment[] = [];
    for (const raw of email.attachments) {
      if (!isRecord(raw) || typeof raw.filename !== 'string') break;
      const match = stored.get(raw.filename);
      if (match === undefined) break;
      reused.push(match);
    }
    if (reused.length !== email.attachments.length) {
      out.push(email);
      continue;
    }

    out.push({ ...email, attachments: reused });
  }
  return out;
}
