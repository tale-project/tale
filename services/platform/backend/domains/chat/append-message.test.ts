// @vitest-environment node

/**
 * The chat appender claims its (order, step) slot the same way the generic
 * store does: one statement that reads max+1 and is refused by the unique
 * slot index when a concurrent turn got there first — after which it claims
 * the next slot, so two racing sends never tie a thread's ordering.
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/org-config.ts', () => ({ resolveOrgSlug: vi.fn() }));
vi.mock('../../core/lib/providers/org_providers.ts', () => ({
  resolveProvidersForOrg: vi.fn(),
}));
vi.mock('../../core/lib/providers/catalog_fetch.ts', () => ({
  getProviderCatalog: vi.fn(),
}));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

import { attachmentOwnershipForParts } from '../files/chat-ownership.ts';
import { MESSAGE_SLOT_CLAIM_DEADLINE_MS } from '../threads/store.ts';
import { appendMessageRow } from './store.ts';

function fragmentText(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    'text' in value &&
    typeof value.text === 'string'
  )
    return value.text;
  return '?';
}

/** A `sql` whose INSERTs answer from `outcomes` in order (an empty array is a
 * lost race); every other statement finds nothing. */
function fakeSql(
  outcomes: (
    | {
        id: string | null;
        order: number | null;
        missingAttachments?: boolean;
      }[]
    | Error
  )[],
): {
  sql: Sql;
  statements: string[];
  jsonInputs: unknown[];
  begin: ReturnType<typeof vi.fn>;
} {
  const statements: string[] = [];
  const jsonInputs: unknown[] = [];
  let inserts = 0;
  const begin = vi.fn(() => {
    throw new Error('Nested transaction');
  });
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce(
      (result, segment, index) =>
        result +
        segment +
        (index < values.length ? fragmentText(values[index]) : ''),
      '',
    );
    const isInsert = text.includes('INSERT INTO app.messages');
    if (isInsert || /^\s*(UPDATE|SELECT branch_root_id)/.test(text)) {
      statements.push(text);
    }
    const outcome = isInsert ? (outcomes[inserts++] ?? []) : [];
    return Object.assign(
      outcome instanceof Error
        ? Promise.reject(outcome)
        : Promise.resolve(outcome),
      {
        text,
        toString: () => text,
      },
    );
  };
  Object.assign(tag, {
    json: (value: unknown) => {
      jsonInputs.push(value);
      return value;
    },
    begin,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call and `json` are exercised
  return { sql: tag as unknown as Sql, statements, jsonInputs, begin };
}

const MESSAGE = {
  organizationId: 'org-1',
  threadId: 't-1',
  role: 'assistant',
  parts: [],
  status: 'pending',
};

const insertsOf = (statements: string[]): number =>
  statements.filter((text) => text.includes('INSERT INTO app.messages')).length;

describe('appendMessageRow — claiming a unique slot', () => {
  it('lands on the computed slot when nobody raced it', async () => {
    const { sql, statements } = fakeSql([[{ id: 'm-1', order: 7 }]]);
    await expect(appendMessageRow(sql, MESSAGE)).resolves.toEqual({
      id: 'm-1',
      sequence: 7,
    });
    expect(insertsOf(statements)).toBe(1);
    expect(statements[0]).toContain(
      'ON CONFLICT (thread_id, "order", step_order) DO NOTHING',
    );
  });

  it('re-claims the next slot after losing the race for one', async () => {
    const { sql, statements } = fakeSql([[], [], [{ id: 'm-3', order: 9 }]]);
    await expect(appendMessageRow(sql, MESSAGE)).resolves.toEqual({
      id: 'm-3',
      sequence: 9,
    });
    expect(insertsOf(statements)).toBe(3);
  });

  it('keeps re-claiming through a burst larger than any fixed count', async () => {
    const lostRaces = Array.from({ length: 40 }, () => []);
    const { sql, statements } = fakeSql([
      ...lostRaces,
      [{ id: 'm-41', order: 40 }],
    ]);
    const pauses: number[] = [];
    await expect(
      appendMessageRow(sql, MESSAGE, {
        sleep: (ms) => {
          pauses.push(ms);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ id: 'm-41', sequence: 40 });
    expect(insertsOf(statements)).toBe(41);
    // One jittered pause per lost race, never longer than the cap.
    expect(pauses).toHaveLength(40);
    expect(Math.max(...pauses)).toBeLessThanOrEqual(30);
  });

  it('lets an error from the claim through unchanged, after one insert', async () => {
    // Under SERIALIZABLE the lost race surfaces as a 40001 and the enclosing
    // transactSerializable reruns the transaction; the claim must not retry
    // or swallow it.
    const boom = Object.assign(new Error('could not serialize access'), {
      code: '40001',
    });
    const { sql, statements } = fakeSql([boom]);
    await expect(
      appendMessageRow(sql, MESSAGE, { sleep: () => Promise.resolve() }),
    ).rejects.toBe(boom);
    expect(insertsOf(statements)).toBe(1);
  });

  it('fails loudly, and writes nothing else, once the deadline is spent', async () => {
    const { sql, statements } = fakeSql([]);
    // Each clock read advances 4 s: the 10 s budget is gone at the third claim.
    let clock = 0;
    await expect(
      appendMessageRow(sql, MESSAGE, {
        now: () => (clock += 4_000),
        sleep: () => Promise.resolve(),
      }),
    ).rejects.toThrow(
      `no free slot within ${MESSAGE_SLOT_CLAIM_DEADLINE_MS} ms (3 attempts)`,
    );
    expect(insertsOf(statements)).toBe(3);
    expect(statements.some((text) => text.includes('UPDATE'))).toBe(false);
  });
});

describe('appendMessageRow — locked attachment provenance', () => {
  const parts = [
    {
      type: 'attachment',
      fileId: 'ref-1',
      attachmentOwnership: { owned: true },
    },
    { type: 'attachment', fileId: 'ref-1' },
    { type: 'text', text: 'hello', fileId: 'not-an-attachment' },
    { type: 'attachment', fileId: 'ref-2' },
  ];

  it('classifies only same-org rows returned by the materialized share lock', async () => {
    const { sql, statements, jsonInputs, begin } = fakeSql([
      [{ id: 'm-1', order: 0 }],
    ]);
    await appendMessageRow(sql, { ...MESSAGE, role: 'user', parts });
    const insert = statements[0];
    expect(insert).toContain('locked_attachment_files AS MATERIALIZED');
    expect(insert).toContain('file.org_id = ?');
    expect(insert).toContain(
      'file.storage_ref IN (SELECT ref FROM requested_attachment_refs)',
    );
    expect(insert).toContain('ORDER BY file.id');
    expect(insert).toContain('FOR SHARE OF file');
    expect(insert).toContain(
      'FROM locked_attachment_files file JOIN app.thread_metadata thread',
    );
    expect(insert?.match(/FROM app.file_metadata/g)).toHaveLength(1);
    expect(jsonInputs[0]).toEqual(['ref-1', 'ref-2']);
    expect(insert).toContain("jsonb_build_object('owned', true)");
    expect(insert).toContain("jsonb_build_object('fileId', file.id)");
    expect(insert).toContain(
      "jsonb_build_object('documentId', file.document_id)",
    );
    expect(insert).toContain('file.uploaded_by = thread.user_id');
    expect(insert).toContain('file.thread_id = thread.thread_id');
    expect(insert).toContain('file.thread_id = thread.branch_root_id');
    expect(insert).toContain('file.document_id IS NULL');
    expect(begin).not.toHaveBeenCalled();
    expect(insertsOf(statements)).toBe(1);
  });

  it('refuses a referenced row deleted during the lock wait without retrying or touching the thread', async () => {
    const { sql, statements } = fakeSql([
      [{ id: null, order: null, missingAttachments: true }],
    ]);
    const sleep = vi.fn(() => Promise.resolve());
    await expect(
      appendMessageRow(sql, { ...MESSAGE, role: 'user', parts }, { sleep }),
    ).rejects.toMatchObject({
      code: 'ATTACHMENT_UNAVAILABLE',
      status: 409,
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(
      'HAVING NOT EXISTS (SELECT 1 FROM missing_attachment_refs)',
    );
    expect(statements[0]).toContain(
      'SELECT 1 FROM locked_attachment_files file WHERE file.storage_ref = requested.ref',
    );
    expect(statements[0]).toContain('true AS "missingAttachments"');
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    { ...MESSAGE, role: 'assistant', parts },
    { ...MESSAGE, role: 'user', parts: [] },
    { ...MESSAGE, role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    { ...MESSAGE, role: 'user', parts: undefined },
  ])('requests no file locks for $role with parts $parts', async (message) => {
    const { sql, jsonInputs, begin } = fakeSql([[{ id: 'm-1', order: 0 }]]);
    await appendMessageRow(sql, message);
    expect(jsonInputs[0]).toEqual([]);
    expect(begin).not.toHaveBeenCalled();
  });

  it('rechecks the locked provenance on each slot retry', async () => {
    const { sql, statements } = fakeSql([[], [{ id: 'm-1', order: 1 }]]);
    await appendMessageRow(
      sql,
      { ...MESSAGE, role: 'user', parts },
      { sleep: () => Promise.resolve() },
    );
    const inserts = statements.filter((text) =>
      text.includes('INSERT INTO app.messages'),
    );
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert).toContain('locked_attachment_files AS MATERIALIZED');
      expect(insert).toContain(
        'FROM locked_attachment_files file JOIN app.thread_metadata thread',
      );
    }
  });

  it('keeps the default ownership source for existing callers', () => {
    const { sql } = fakeSql([]);
    expect(
      fragmentText(attachmentOwnershipForParts(sql, 'org-1', 't-1', parts)),
    ).toContain('FROM app.file_metadata file JOIN app.thread_metadata thread');
  });
});
