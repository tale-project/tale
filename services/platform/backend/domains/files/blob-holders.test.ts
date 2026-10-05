// @vitest-environment node

import type { Fragment, Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { blobRefHeld, listedBlobRefHeld } from './blob-holders.ts';

/**
 * The one answer to "may these bytes go?" for every lane that deletes bytes
 * outside the release seam, as the statement states it: a file row in any
 * lifecycle, a document's current file or retained version, or a listed
 * holder — a task's attachment or deliverable, a pending outbound mail's
 * attachment, a user's chat attachment — each scoped to the organization.
 */

interface Rendered {
  text: string;
  values: unknown[];
}

const RENDERED = Symbol('rendered');

function isRendered(value: unknown): value is Rendered & { [RENDERED]: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [RENDERED]?: true })[RENDERED] === true
  );
}

/** A tag double that renders nested fragments the way postgres.js does. */
function tag(): Sql {
  const render = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isRendered(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    return {
      [RENDERED]: true,
      text: text.replace(/\s+/g, ' ').trim(),
      values: flat,
    };
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return render as unknown as Sql;
}

function rendered(fragment: Fragment): Rendered {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the double answers rendered text, not a query
  return fragment as unknown as Rendered;
}

describe('blobRefHeld', () => {
  it('holds the bytes for a file row, a document (current or retained) or a listed holder of the org', () => {
    const sql = tag();
    const held = rendered(blobRefHeld(sql, 'org_1', sql`i.s3_ref`));
    const listed = rendered(listedBlobRefHeld(sql, 'org_1', sql`i.s3_ref`));
    expect(held.text).toBe(
      `(EXISTS ( SELECT 1 FROM app.file_metadata held_file WHERE held_file.org_id = ? AND held_file.storage_ref = i.s3_ref ) OR EXISTS ( SELECT 1 FROM app.documents held_doc WHERE held_doc.org_id = ? AND (held_doc.file_ref = i.s3_ref OR held_doc.history_files @> ARRAY[i.s3_ref::text]) ) OR EXISTS ( SELECT 1 FROM app.blob_composer_handoffs handoff WHERE handoff.org_id = ? AND handoff.storage_ref = i.s3_ref AND handoff.expires_at_ms > ? ) OR ${listed.text})`,
    );
    expect(held.values).toEqual([
      'org_1',
      'org_1',
      'org_1',
      expect.any(Number),
      ...listed.values,
    ]);
  });

  it('parameterizes every ref occurrence and organization scope', () => {
    const sql = tag();
    const ref = 's3:blobs/acme/brief.pdf';
    const held = rendered(blobRefHeld(sql, 'org_1', sql`${ref}`));
    expect(held.text).toContain('held_file.storage_ref = ?');
    expect(held.text).toContain(
      'held_doc.file_ref = ? OR held_doc.history_files @> ARRAY[?::text]',
    );
    expect(held.text).toContain("jsonb_build_object('fileId', ?::text)");
    expect(held.text).toContain("jsonb_build_object('storageId', ?::text)");
    expect(held.text).toContain("'type', 'attachment', 'fileId', ?::text");
    expect(held.values).toEqual([
      'org_1',
      ref,
      'org_1',
      ref,
      ref,
      'org_1',
      ref,
      expect.any(Number),
      'org_1',
      ref,
      'org_1',
      ref,
      'org_1',
      ref,
      ref,
      'org_1',
      ref,
      ref,
    ]);
  });
});

describe('listedBlobRefHeld', () => {
  it('lists a task, a pending outbound mail and a user’s chat message of the org (#4111)', () => {
    const sql = tag();
    const held = rendered(listedBlobRefHeld(sql, 'org_1', sql`r.ref`));
    expect(held.text).toContain(
      "SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', r.ref::text))",
    );
    expect(held.text).toContain(
      "SELECT 1 FROM app.conversation_messages held_mail WHERE held_mail.org_id = ? AND held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed')",
    );
    expect(held.text).toContain(
      "held_mail.metadata->'attachments' @> jsonb_build_array(jsonb_build_object('storageId', r.ref::text))",
    );
    expect(held.text).toContain(
      "held_chat.parts @> jsonb_build_array(jsonb_build_object( 'type', 'attachment', 'fileId', r.ref::text ))",
    );
    expect(held.values).toEqual(['org_1', 'org_1', 'org_1', 'org_1']);
  });

  it('keeps pending mail independent of API source closure', () => {
    const sql = tag();
    const { text } = rendered(listedBlobRefHeld(sql, 'org_1', sql`r.ref`));
    expect(text).not.toContain('app.conversation_api_bindings');
    expect(text).not.toContain('source_deleted');
    expect(text).toContain("held_mail.delivery_state IN ('queued', 'failed')");
  });

  it('requires independent upload provenance, excluding document-bound attachments', () => {
    const sql = tag();
    const { text } = rendered(listedBlobRefHeld(sql, 'org_1', sql`r.ref`));
    expect(text).toContain(
      "held_chat.attachment_ownership->r.ref::text @> '{\"owned\":true}'::jsonb OR ( NOT (coalesce(held_chat.attachment_ownership, '{}'::jsonb) ? r.ref::text) AND EXISTS (",
    );
    expect(text).toContain(
      'ON thread.org_id = file.org_id AND thread.thread_id = held_chat.thread_id',
    );
    expect(text).toContain(
      'WHERE file.org_id = ? AND file.storage_ref = r.ref AND (file.document_id IS NULL AND ( file.uploaded_by = thread.user_id OR file.thread_id = thread.thread_id OR file.thread_id = thread.branch_root_id ))',
    );
    expect(text).toContain(
      "WHERE held_chat.org_id = ? AND held_chat.role = 'user'",
    );
  });

  it('holds a mail only while it may still be sent, and a chat ref only on a user row', () => {
    const sql = tag();
    const { text } = rendered(listedBlobRefHeld(sql, 'org_1', sql`r.ref`));
    // A sent or delivered message, or an inbound one, holds nothing.
    expect(text).toContain(
      "held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed')",
    );
    expect(text).toContain("held_chat.role = 'user'");
  });
});
