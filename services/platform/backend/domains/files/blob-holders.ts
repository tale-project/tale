import type { Fragment, Sql, TransactionSql } from 'postgres';

import { taskHoldsBlobRef } from '../tasks/blob-holders.ts';

/**
 * May the BYTES of a blob ref go? Not while some row of the organization
 * still holds the ref:
 *
 *  - a file row (`app.file_metadata.storage_ref`), whatever its lifecycle —
 *    a trashed row is restorable, and its purge goes through the release
 *    seam, which judges the bytes again then;
 *  - a document, as its current file (`file_ref`) or as a retained version
 *    (`history_files` — controlled-record snapshots need their bytes);
 *  - a task, a pending outbound mail or a chat message, the holders that
 *    list a ref with no file row of their own ({@link listedBlobRefHeld}).
 *
 * ONE predicate for every lane that deletes bytes outside the release seam:
 * `deleteFile` once its own row is gone, the abandoned-upload sweep and the
 * rejected-upload reclaim (`upload-intents.ts`), a product's released
 * managed image (`products/service.ts`), and a video link's cleanup and
 * unbound GC (`video_links/service.ts`, through `deleteUnheldOrgBlobRefs`).
 * Each lane used to carry its own copy, or none, and a lane that missed a
 * holder deleted that holder's bytes: the reclaim asked about file rows
 * alone and took a task's attachment (2026-10-03, #4104); the product image
 * release asked about file rows and current documents, and the video-link
 * lanes asked nothing (#4110). A new holder joins here, once, for all of
 * them. The
 * release seam (`knowledge/liveness.ts`) asks a sibling question in the
 * middle of a purge — live rows only, minus the document or file row being
 * purged — and keeps its own statement for that reason; the listed holders
 * it shares through {@link listedBlobRefHeld}.
 *
 * `ref` is a fragment, as in `taskHoldsBlobRef`: a parameter
 * (``sql`${ref}` ``) or a column of the caller's query (``sql`i.s3_ref` ``).
 */
export function blobRefHeld(
  sql: Sql | TransactionSql,
  organizationId: string,
  ref: Fragment,
): Fragment {
  return sql`(EXISTS (
    SELECT 1 FROM app.file_metadata held_file
    WHERE held_file.org_id = ${organizationId}
      AND held_file.storage_ref = ${ref}
  ) OR EXISTS (
    SELECT 1 FROM app.documents held_doc
    WHERE held_doc.org_id = ${organizationId}
      AND (held_doc.file_ref = ${ref}
           OR held_doc.history_files @> ARRAY[${ref}::text])
  ) OR ${listedBlobRefHeld(sql, organizationId, ref)})`;
}

/**
 * The holders that LIST a blob ref with no file row of their own, so no
 * row-driven check finds them — ONE list for {@link blobRefHeld} and the
 * release seam's blob verdict (`knowledge/liveness.ts`), which both ask it:
 *
 *  - a task, as an attachment or a deliverable (`tasks/blob-holders.ts`);
 *  - a pending outbound mail: an `outbound` conversation message still
 *    `queued` (inside its undo window, or waiting for its send or for the
 *    external app to claim it) or `failed` (a retry sends it again), whose
 *    `metadata.attachments` names the ref as `storageId` — the email and
 *    the API channel alike. The send reads the bytes from the ref, so a
 *    file row deleted or purged under a queued reply left the send nothing
 *    to attach (#4111). A sent or delivered message holds nothing: the copy
 *    the recipient got is theirs;
 *  - a chat message: a `user` row whose parts carry the ref as an
 *    `attachment` — every later turn of the thread replays it from the ref
 *    (`core/chat/turn_action.ts`), with no file row to ask. A parked send
 *    (`app.deferred_sends`) is not a holder: it fires through the chat gate,
 *    which admits a ref only while its file row lives.
 *
 * Each arm is scoped to the organization. No index serves the task or the
 * chat arm, by decision (#4111): both scan the organization's rows, and a
 * write-locking index build on `app.messages` is not worth what they cost.
 * Measured on synthetic data (PostgreSQL 16, one organization beside ten
 * others, a ref nothing holds — the worst case):
 *
 *   | arm                                   | rows of the org | plan         | time         |
 *   | ------------------------------------- | --------------- | ------------ | ------------ |
 *   | task                                  | 100k tasks      | seq scan     | 263 ms       |
 *   | mail, pending outbound only           | 200k messages   | index (org,  | 11 ms        |
 *   |                                       |                 | state, …)    |              |
 *   | chat, user rows                       | 400k messages   | seq scan     | 516–612 ms   |
 *   | chat, with a partial index (not here) | 400k messages   | bitmap scan  | 30–85 ms     |
 *
 * Each evaluation pays this cost per ref: a file delete or reclaim, or a
 * bounded expired-intent batch on the mint path. Repeated sweeps can ask
 * again for a held ref or a failed delete. Should a profile show either arm, a
 * partial index on `app.messages (org_id) WHERE role = 'user' AND parts @>
 * '[{"type":"attachment"}]'` (and a GIN index for the task arm) is the
 * measured next step.
 */
export function listedBlobRefHeld(
  sql: Sql | TransactionSql,
  organizationId: string,
  ref: Fragment,
): Fragment {
  return sql`(${taskHoldsBlobRef(sql, organizationId, ref)} OR EXISTS (
    SELECT 1 FROM app.conversation_messages held_mail
    WHERE held_mail.org_id = ${organizationId}
      AND held_mail.direction = 'outbound'
      AND held_mail.delivery_state IN ('queued', 'failed')
      AND held_mail.metadata->'attachments'
          @> jsonb_build_array(jsonb_build_object('storageId', ${ref}::text))
  ) OR EXISTS (
    SELECT 1 FROM app.messages held_chat
    WHERE held_chat.org_id = ${organizationId}
      AND held_chat.role = 'user'
      AND held_chat.parts @> jsonb_build_array(jsonb_build_object(
        'type', 'attachment', 'fileId', ${ref}::text
      ))
  ))`;
}
