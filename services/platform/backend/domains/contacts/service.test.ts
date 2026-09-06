/**
 * Contact creation — one concept, three doors. The directory's email
 * uniqueness used to exist only as a check-then-act probe on the bulk
 * import (no lock, blind to trash), while the single create never checked
 * and the mail-ingest shim carried its own inline copy (blind to trash, no
 * audit row). Every create now serializes per (org, email), looks only at
 * live rows, lands through one insert and records the same audit/event/hint.
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

import {
  bulkCreateContacts,
  ContactError,
  createContact,
  findOrCreateContactByEmail,
} from './service.ts';

type Statement = { text: string; values: unknown[] };

/** A `sql` stand-in recording every statement, answering per text; `begin`
 * runs the callback on the same tag and counts its transactions. */
function recordingSql(
  answer: (text: string, values: unknown[]) => unknown[] = () => [],
) {
  const statements: Statement[] = [];
  const begins = { count: 0 };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
    begin: (fn: (tx: unknown) => Promise<unknown>) => {
      begins.count += 1;
      return fn(sql);
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: sql as unknown as Sql, statements, begins };
}

const isLock = (s: Statement) => s.text.includes('pg_advisory_xact_lock');
const isLookup = (s: Statement) =>
  s.text.startsWith('SELECT id FROM app.contacts');
const isInsert = (s: Statement) => s.text.includes('INSERT INTO app.contacts');

const SCOPE = {
  organizationId: 'o1',
  userId: 'u1',
  email: 'member@example.test',
  role: 'admin',
};

/** Answers the lookup of `email` with a live twin (any other key with no
 * row) and every insert with a fresh id. */
function twinAnswer(email: string) {
  return (text: string, values: unknown[]) => {
    if (text.startsWith('SELECT id FROM app.contacts')) {
      return email !== '' && values.includes(email)
        ? [{ id: `twin-of-${email}` }]
        : [];
    }
    if (text.includes('INSERT INTO app.contacts')) return [{ id: 'ct-new' }];
    return [];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createContact — the member door', () => {
  it('locks the (org, email) key before it looks, and only at live rows', async () => {
    const { sql, statements } = recordingSql(twinAnswer(''));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- begin() hands the same tag back as the tx
    const id = await createContact(sql as never, SCOPE, {
      name: 'Ada',
      email: ' Ada@Example.com ',
      source: 'manual_import',
    });
    expect(id).toBe('ct-new');
    const lockIndex = statements.findIndex(isLock);
    const lookupIndex = statements.findIndex(isLookup);
    const insertIndex = statements.findIndex(isInsert);
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lookupIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(lookupIndex);
    expect(statements[lockIndex]?.values).toEqual(['o1', 'ada@example.com']);
    expect(statements[lookupIndex]?.text).toContain(
      "lifecycle_status IS DISTINCT FROM 'trashed'",
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        actorId: 'u1',
        actorType: 'user',
        actorEmail: 'member@example.test',
        action: 'contact.created',
        resourceId: 'ct-new',
      }),
    );
    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('refuses a live twin with 409 CONTACT_DUPLICATE_EMAIL and inserts nothing', async () => {
    const { sql, statements } = recordingSql(twinAnswer('ada@example.com'));
    await expect(
      createContact(sql as never, SCOPE, {
        email: 'ADA@example.com',
        source: 'manual_import',
      }),
    ).rejects.toMatchObject({
      name: 'ContactError',
      code: 'CONTACT_DUPLICATE_EMAIL',
      status: 409,
    });
    expect(statements.some(isInsert)).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('takes no lock and runs no lookup for a contact without an email', async () => {
    const { sql, statements } = recordingSql(twinAnswer(''));
    await createContact(sql as never, SCOPE, {
      name: 'Phone only',
      phone: '+49 30 1',
      source: 'manual_import',
    });
    expect(statements.some(isLock)).toBe(false);
    expect(statements.some(isLookup)).toBe(false);
    expect(statements.some(isInsert)).toBe(true);
  });

  it('still refuses a role without contacts write', async () => {
    const { sql } = recordingSql();
    await expect(
      createContact(
        sql as never,
        { ...SCOPE, role: 'member' },
        { email: 'x@example.com', source: 'manual_import' },
      ),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
  });
});

describe('findOrCreateContactByEmail — the mail-ingest door', () => {
  it('adopts the live row under the same lock and writes nothing', async () => {
    const { sql, statements } = recordingSql(twinAnswer('carla@ext.test'));
    await expect(
      findOrCreateContactByEmail(sql as never, {
        organizationId: 'o1',
        email: ' Carla@Ext.Test ',
        name: 'Carla',
        source: 'conversation',
      }),
    ).resolves.toEqual({
      contactId: 'twin-of-carla@ext.test',
      created: false,
    });
    expect(statements.findIndex(isLock)).toBeLessThan(
      statements.findIndex(isLookup),
    );
    expect(statements[statements.findIndex(isLock)]?.values).toEqual([
      'o1',
      'carla@ext.test',
    ]);
    expect(statements.some(isInsert)).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('mints a contact as the system actor with audit row, event and hint', async () => {
    const { sql, statements } = recordingSql(twinAnswer(''));
    await expect(
      findOrCreateContactByEmail(sql as never, {
        organizationId: 'o1',
        email: 'carla@ext.test',
        name: 'Carla',
        source: 'conversation',
        metadata: { createdFrom: 'email_sync' },
      }),
    ).resolves.toEqual({ contactId: 'ct-new', created: true });
    const insert = statements.find(isInsert);
    expect(insert?.values).toEqual(
      expect.arrayContaining(['o1', 'Carla', 'carla@ext.test', 'conversation']),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        action: 'contact.created',
        resourceId: 'ct-new',
        resourceName: 'Carla',
      }),
    );
    expect(createAuditLog.mock.calls[0]?.[1]).not.toHaveProperty('actorEmail');
    expect(emitEvent).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        eventType: 'contact.created',
        eventData: { contactId: 'ct-new' },
      }),
    );
    expect(emitHintInTx).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ entity: 'contact', entityId: 'ct-new' }),
    );
  });

  it('refuses an empty email instead of minting a nameless row', async () => {
    const { sql, statements } = recordingSql();
    await expect(
      findOrCreateContactByEmail(sql as never, {
        organizationId: 'o1',
        email: '   ',
        source: 'conversation',
      }),
    ).rejects.toBeInstanceOf(ContactError);
    expect(statements).toHaveLength(0);
  });
});

describe('bulkCreateContacts — the import door', () => {
  it('runs each item in its own locked transaction and accounts the duplicate alone', async () => {
    const { sql, statements, begins } = recordingSql(
      twinAnswer('beta@door.test'),
    );
    const result = await bulkCreateContacts(sql, SCOPE, [
      { name: 'Alpha', email: 'alpha@door.test' },
      { name: 'Beta', email: 'Beta@door.test', externalId: 77 },
      { name: 'Gamma', email: 'gamma@door.test', externalId: 'ext-g' },
    ]);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ index: 1, errorCode: 'duplicate_email' }),
    ]);
    expect(begins.count).toBe(3);
    expect(statements.filter(isInsert)).toHaveLength(2);
    // Every lock precedes its lookup; the external-id lock follows the email
    // lock so two importers never hold the pair in opposite order.
    const gammaLocks = statements
      .filter(isLock)
      .filter(
        (s) =>
          s.values.includes('ext-g') || s.values.includes('gamma@door.test'),
      );
    expect(gammaLocks.map((s) => s.values[1])).toEqual([
      'gamma@door.test',
      'ext-g',
    ]);
    // Rows land without per-contact audit rows (the import is the audited act).
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
