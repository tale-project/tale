'use node';

/**
 * Persist attachment bytes returned from a mail connector onto org blob
 * storage, then replace them with a durable `storageId` for the Inbox.
 *
 * NO download URL is stored: a presigned GET is minted at READ time from the
 * storageId (the conversation projection calls `getFileUrl`). Storing a URL here
 * baked in the retired Convex proxy's `/http_api/storage` path, which the 0.5
 * serve layer answers 404 — every materialized attachment chip's download died
 * on it. The storageId is stable; the URL must be fresh, so it is read-time.
 *
 * Gmail/Outlook store attachments during `get_message` through the
 * connector's own `ctx.files` sink; IMAP returns `contentBase64` on each part
 * instead, and this helper is that sync path's sink.
 *
 * `'use node'` because the base64 decode goes through `Buffer` — every other
 * `Buffer` user under `convex/` declares the same, and only the `'use node'`
 * `sync_mailbox` host calls this.
 */

import { isRecord } from '../../../../lib/utils/type-utils';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';

type WireAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  storageId?: string;
  url?: string;
  contentBase64?: string;
};

function asWireAttachment(value: unknown): WireAttachment | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.filename !== 'string') {
    return null;
  }
  if (typeof value.contentType !== 'string' || typeof value.size !== 'number') {
    return null;
  }
  return {
    id: value.id,
    filename: value.filename,
    contentType: value.contentType,
    size: value.size,
    ...(typeof value.contentId === 'string' && { contentId: value.contentId }),
    ...(typeof value.storageId === 'string' && { storageId: value.storageId }),
    ...(typeof value.url === 'string' && { url: value.url }),
    ...(typeof value.contentBase64 === 'string' && {
      contentBase64: value.contentBase64,
    }),
  };
}

async function storeAttachment(
  ctx: ActionCtx,
  organizationId: string,
  source: string,
  att: WireAttachment,
): Promise<WireAttachment> {
  const raw = att.contentBase64;
  if (raw === undefined || raw === '') {
    const { contentBase64: _drop, ...rest } = att;
    return rest;
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
  } catch {
    console.warn(
      '[materializeEmailAttachments] invalid base64; keeping metadata only',
      { filename: att.filename },
    );
    const { contentBase64: _drop, ...rest } = att;
    return rest;
  }

  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);

  const storageId = await ctx.runAction(
    internal.files.blob_actions.storeOrgBlob,
    {
      organizationId,
      bytes: payload,
      contentType: att.contentType,
    },
  );

  await ctx.runMutation(
    internal.file_metadata.internal_mutations.saveFileMetadata,
    {
      organizationId,
      storageId,
      fileName: att.filename,
      contentType: att.contentType,
      size: bytes.byteLength,
      source,
      // Not indexed HERE. The conversation is not resolved yet — bytes are
      // drained per message, before ingest — so there is nothing to scope the
      // corpus row to, and an unscoped row would be an org-wide hub document.
      // `bindFileToConversation` queues and dispatches it once the conversation
      // is known.
      //
      // Still `skipRagIndexing`, not `deferRagDispatch`: the latter marks the
      // row `'queued'`, which is a promise to dispatch, and a queued row that is
      // never dispatched counts against the org's RAG cap forever — three of
      // them starve every real upload. Nothing on this path can keep that
      // promise, because binding is best-effort and may not happen at all. The
      // binder makes the promise and keeps it in one transaction instead.
      skipRagIndexing: true,
    },
  );

  // No `url`: the download is presigned from `storageId` at read time. A URL
  // minted here would be a long-lived pointer through a serve path the 0.5
  // backend does not answer.
  return {
    id: att.id,
    filename: att.filename,
    contentType: att.contentType,
    size: bytes.byteLength > 0 ? bytes.byteLength : att.size,
    storageId,
    ...(att.contentId !== undefined && { contentId: att.contentId }),
  };
}

/**
 * Walk fetched email objects and materialize any `contentBase64` attachments.
 * Emails without wire bytes pass through unchanged (metadata-only attachments
 * stay as chips the user can see but not open until a download path lands).
 */
export async function materializeEmailAttachments(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    /** Provenance slug for `fileMetadata.source` (e.g. `imap-smtp`). */
    source: string;
    emails: unknown[];
  },
): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const email of args.emails) {
    if (!isRecord(email) || !Array.isArray(email.attachments)) {
      out.push(email);
      continue;
    }
    const nextAttachments: WireAttachment[] = [];
    for (const raw of email.attachments) {
      const att = asWireAttachment(raw);
      if (att === null) continue;
      nextAttachments.push(
        await storeAttachment(ctx, args.organizationId, args.source, att),
      );
    }
    out.push({ ...email, attachments: nextAttachments });
  }
  return out;
}
