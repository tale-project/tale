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
    expect(held.text).toBe(
      "(EXISTS ( SELECT 1 FROM app.file_metadata held_file WHERE held_file.org_id = ? AND held_file.storage_ref = i.s3_ref ) OR EXISTS ( SELECT 1 FROM app.documents held_doc WHERE held_doc.org_id = ? AND (held_doc.file_ref = i.s3_ref OR held_doc.history_files @> ARRAY[i.s3_ref::text]) ) OR (EXISTS ( SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', i.s3_ref::text)) ) OR EXISTS ( SELECT 1 FROM app.conversation_messages held_mail WHERE held_mail.org_id = ? AND held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed') AND held_mail.metadata->'attachments' @> jsonb_build_array(jsonb_build_object('storageId', i.s3_ref::text)) ) OR EXISTS ( SELECT 1 FROM app.messages held_chat WHERE held_chat.org_id = ? AND held_chat.role = 'user' AND held_chat.parts @> jsonb_build_array(jsonb_build_object( 'type', 'attachment', 'fileId', i.s3_ref::text )) )))",
    );
    expect(held.values).toEqual(['org_1', 'org_1', 'org_1', 'org_1', 'org_1']);
  });

  it('takes the ref as a parameter, bound once per arm', () => {
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
      'org_1',
      ref,
      'org_1',
      ref,
    ]);
  });
});

describe('listedBlobRefHeld', () => {
  it('lists a task, a pending outbound mail and a user’s chat message of the org (#4111)', () => {
    const sql = tag();
    const held = rendered(listedBlobRefHeld(sql, 'org_1', sql`r.ref`));
    expect(held.text).toBe(
      "(EXISTS ( SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', r.ref::text)) ) OR EXISTS ( SELECT 1 FROM app.conversation_messages held_mail WHERE held_mail.org_id = ? AND held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed') AND held_mail.metadata->'attachments' @> jsonb_build_array(jsonb_build_object('storageId', r.ref::text)) ) OR EXISTS ( SELECT 1 FROM app.messages held_chat WHERE held_chat.org_id = ? AND held_chat.role = 'user' AND held_chat.parts @> jsonb_build_array(jsonb_build_object( 'type', 'attachment', 'fileId', r.ref::text )) ))",
    );
    expect(held.values).toEqual(['org_1', 'org_1', 'org_1']);
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
