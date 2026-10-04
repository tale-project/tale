// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { assessRefLiveness } from './liveness.ts';

/**
 * The two liveness verdicts for a blob ref, as the statement states them.
 * An emailed attachment keeps its corpus copy only while its conversation
 * does — not deleted, not marked spam, the verdict an email body gets — but
 * its bytes follow the file row alone: a spam verdict is lifted as often as
 * it is kept, and a deleted conversation's attachment is still a stored
 * file. A task's attachments and deliverables hold their bytes with no row
 * of their own (`tasks/blob-holders.ts`), so the blob verdict asks the
 * tasks too; the corpus verdict does not — a task is not the library. The
 * rows those clauses decide are proven on real Postgres in the
 * `checkEmailedAttachments` and `checkTaskHeldBlobOutlivesFileRow` lanes;
 * this pins where each clause sits.
 */

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** Records the statements Postgres would receive, nested fragments
 * (``sql`r.ref` ``, a shared predicate) inlined the way postgres.js does. */
function recorder(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (/^(SELECT|INSERT|UPDATE|DELETE)/.test(text)) statements.push(text);
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve([]), fragment);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: tag as unknown as Sql, statements };
}

function halves(statement: string | undefined): {
  corpus: string;
  blob: string;
} {
  const at = statement?.indexOf('AS "corpusLive"') ?? 0;
  return {
    corpus: statement?.slice(0, at) ?? '',
    blob: statement?.slice(at) ?? '',
  };
}

describe('assessRefLiveness — an emailed attachment', () => {
  it('ties the corpus copy to a live, unjunked conversation and the bytes to the file row', async () => {
    const { sql, statements } = recorder();
    await assessRefLiveness(sql, {
      organizationId: 'org-1',
      refs: ['s3:org-1/mail/cv.pdf'],
    });
    const { corpus, blob } = halves(statements[0]);
    expect(corpus).toContain(
      "AND (fm.conversation_id IS NULL OR EXISTS( SELECT 1 FROM app.conversations c WHERE c.id = fm.conversation_id AND c.org_id = fm.org_id AND c.status IS DISTINCT FROM 'spam' ))",
    );
    expect(blob).not.toContain('app.conversations');
  });

  it('asks nothing for no ref', async () => {
    const { sql, statements } = recorder();
    expect(
      await assessRefLiveness(sql, { organizationId: 'org-1', refs: [] }),
    ).toEqual([]);
    expect(statements).toEqual([]);
  });
});

describe('assessRefLiveness — a listed holder', () => {
  it('keeps the bytes while a task, a pending outbound mail or a chat message lists the ref, and leaves the corpus verdict to the rows', async () => {
    const { sql, statements } = recorder();
    await assessRefLiveness(sql, {
      organizationId: 'org-1',
      refs: ['s3:org-1/brief.pdf'],
    });
    expect(statements).toHaveLength(1);
    const { corpus, blob } = halves(statements[0]);
    // The list `blobRefHeld` asks too (`files/blob-holders.ts`), #4111.
    expect(blob).toContain(
      "OR (EXISTS ( SELECT 1 FROM app.tasks held WHERE held.org_id = ? AND (coalesce(held.attachments, '[]'::jsonb) || coalesce(held.outputs, '[]'::jsonb)) @> jsonb_build_array(jsonb_build_object('fileId', r.ref::text)) ) OR EXISTS ( SELECT 1 FROM app.conversation_messages held_mail WHERE held_mail.org_id = ? AND held_mail.direction = 'outbound' AND held_mail.delivery_state IN ('queued', 'failed') AND held_mail.metadata->'attachments' @> jsonb_build_array(jsonb_build_object('storageId', r.ref::text)) ) OR EXISTS ( SELECT 1 FROM app.messages held_chat WHERE held_chat.org_id = ? AND held_chat.role = 'user' AND held_chat.parts @> jsonb_build_array(jsonb_build_object( 'type', 'attachment', 'fileId', r.ref::text )) )) ) AS \"blobLive\"",
    );
    expect(corpus).not.toContain('app.tasks');
    expect(corpus).not.toContain('app.conversation_messages');
    expect(corpus).not.toContain('app.messages');
  });
});
