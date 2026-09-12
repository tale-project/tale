// @vitest-environment node

/**
 * The contact update's editing vocabulary. The regressions under test:
 * `metadata` and `address` were replaced whole (adding one metadata key
 * wiped every other); `null` was refused, so no spelling cleared a field,
 * while `""` was a silent no-op on one field and stored as `""` on the
 * next; and once a field can be cleared, nothing kept a contact filed
 * under at least one of name, email and externalId — the create's own
 * rule.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog, emitEvent, emitHintInTx } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async (..._args: unknown[]) => 'audit-1'),
  emitEvent: vi.fn(async () => undefined),
  emitHintInTx: vi.fn(async () => undefined),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../events/emit.ts', () => ({ emitEvent }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));
vi.mock('../legal_holds/service.ts', () => ({
  assertNotHeld: vi.fn(async () => undefined),
}));

import { type ContactRow, updateContact } from './service.ts';

type Statement = { text: string; values: unknown[] };

function recordingSql(
  answer: (text: string, values: unknown[]) => unknown[] = () => [],
) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements };
}

const scope = { organizationId: 'org-1', userId: 'user-1', role: 'admin' };
const existing: ContactRow = {
  id: 'c-1',
  organizationId: 'org-1',
  name: 'Ann',
  email: 'ann@example.invalid',
  phone: '+1 555',
  externalId: 'crm-1',
  source: 'api_import',
  locale: 'en',
  address: { city: 'Paris', zip: '75001' },
  tags: ['vip'],
  metadata: { f: 1, nested: { a: 1, b: 2 }, gone: true },
  notes: 'keep in touch',
  lifecycleStatus: null,
  createdAt: 1,
  updatedAt: 1,
};

/** The UPDATE's bound values, by column order of the statement. */
const UPDATE = {
  name: 0,
  email: 1,
  phone: 2,
  externalId: 3,
  source: 4,
  locale: 5,
  address: 6,
  tags: 7,
  metadata: 8,
  notes: 9,
} as const;

function rowAnswer(row: ContactRow = existing) {
  return (text: string) =>
    text.includes('FROM app.contacts WHERE id = ?') ? [row] : [];
}

async function update(
  patch: Parameters<typeof updateContact>[3],
  row: ContactRow = existing,
) {
  const { sql, statements } = recordingSql(rowAnswer(row));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
  await updateContact(sql as never, scope, 'c-1', patch);
  const written = statements.find((s) =>
    s.text.startsWith('UPDATE app.contacts'),
  );
  if (written === undefined) throw new Error('no UPDATE ran');
  return written.values;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('updateContact — metadata merges, address replaces', () => {
  it('merges metadata per RFC 7396: sent keys set, omitted keys stay, null removes', async () => {
    const values = await update({
      metadata: { f: 2, nested: { b: null, c: 3 }, gone: null, added: 'x' },
    });
    expect(values[UPDATE.metadata]).toEqual({
      f: 2,
      nested: { a: 1, c: 3 },
      added: 'x',
    });
    // The other columns are untouched by a metadata-only patch.
    expect(values[UPDATE.name]).toBe('Ann');
    expect(values[UPDATE.address]).toEqual(existing.address);
  });

  it('merges into an unset metadata as an empty object', async () => {
    const values = await update(
      { metadata: { a: 1 } },
      {
        ...existing,
        metadata: null,
      },
    );
    expect(values[UPDATE.metadata]).toEqual({ a: 1 });
  });

  it('replaces the address whole — an address is a unit', async () => {
    const values = await update({ address: { city: 'Rome' } });
    expect(values[UPDATE.address]).toEqual({ city: 'Rome' });
  });
});

describe('updateContact — the clearing rule', () => {
  it('clears every optional field sent as null (tags to an empty list)', async () => {
    const values = await update({
      phone: null,
      locale: null,
      address: null,
      tags: null,
      metadata: null,
      notes: null,
    });
    expect(values[UPDATE.phone]).toBeNull();
    expect(values[UPDATE.locale]).toBeNull();
    expect(values[UPDATE.address]).toBeNull();
    expect(values[UPDATE.tags]).toEqual([]);
    expect(values[UPDATE.metadata]).toBeNull();
    expect(values[UPDATE.notes]).toBeNull();
    // Untouched identity fields stay.
    expect(values[UPDATE.name]).toBe('Ann');
    expect(values[UPDATE.email]).toBe('ann@example.invalid');
  });

  it('reads a blank as null rather than storing an empty string', async () => {
    const values = await update({ phone: '   ', notes: '', locale: ' ' });
    expect(values[UPDATE.phone]).toBeNull();
    expect(values[UPDATE.notes]).toBeNull();
    expect(values[UPDATE.locale]).toBeNull();
  });

  it('trims free text and stores a new email lowercase', async () => {
    const values = await update({
      name: '  Ann Lee  ',
      email: ' New@Example.Invalid ',
      notes: '  hi  ',
    });
    expect(values[UPDATE.name]).toBe('Ann Lee');
    expect(values[UPDATE.email]).toBe('new@example.invalid');
    expect(values[UPDATE.notes]).toBe('hi');
  });

  it('keeps every column on an empty patch', async () => {
    const values = await update({});
    expect(values.slice(0, 10)).toEqual([
      'Ann',
      'ann@example.invalid',
      '+1 555',
      'crm-1',
      'api_import',
      'en',
      existing.address,
      ['vip'],
      existing.metadata,
      'keep in touch',
    ]);
  });
});

describe('updateContact — a contact keeps an identity', () => {
  it('refuses a patch that would clear the last of name, email and externalId', async () => {
    const { sql, statements } = recordingSql(rowAnswer());
    await expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      updateContact(sql as never, scope, 'c-1', {
        name: null,
        email: '',
        externalId: null,
      }),
    ).rejects.toMatchObject({
      name: 'ContactError',
      code: 'CONTACT_IDENTITY_REQUIRED',
      status: 400,
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.contacts')),
    ).toBe(false);
  });

  it('clears one identity field while another remains', async () => {
    const values = await update({ name: null, externalId: null });
    expect(values[UPDATE.name]).toBeNull();
    expect(values[UPDATE.externalId]).toBeNull();
    expect(values[UPDATE.email]).toBe('ann@example.invalid');
  });

  it('leaves a legacy row without identity editable when the patch does not touch identity', async () => {
    const values = await update(
      { notes: 'still reachable' },
      {
        ...existing,
        name: '',
        email: null,
        externalId: null,
      },
    );
    expect(values[UPDATE.notes]).toBe('still reachable');
  });
});
