// @vitest-environment node

/**
 * The external id is the directory's second key, and the create/update
 * doors used to ignore it: a single create admitted the twin the bulk
 * import refuses, and the update never wrote `externalId` or `source` at
 * all — a PATCH carrying either was a silent no-op. Both now run the same
 * locked, live-rows-only uniqueness rule as the email, and the update
 * writes what it was sent.
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

import { ContactError, createContact, updateContact } from './service.ts';

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
const existing = {
  id: 'c-1',
  organizationId: 'org-1',
  name: 'Ann',
  email: 'ann@example.invalid',
  phone: null,
  externalId: 'crm-1',
  source: 'api_import',
  locale: null,
  address: null,
  tags: [],
  metadata: null,
  notes: null,
  lifecycleStatus: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createContact — the external id', () => {
  it('locks the (org, external id) key and refuses a live twin with 409', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('external_id = ?') ? [{ id: 'c-other' }] : [],
    );
    let caught: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      await createContact(sql as never, scope, {
        name: 'Twin',
        externalId: 'crm-1',
        source: 'api_import',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContactError);
    expect(caught).toMatchObject({
      code: 'CONTACT_DUPLICATE_EXTERNAL_ID',
      status: 409,
    });
    const lock = statements.find((s) => s.text.includes('contact-ext:'));
    expect(lock?.values).toContain('crm-1');
    expect(statements.some((s) => s.text.startsWith('INSERT INTO'))).toBe(
      false,
    );
  });

  it('inserts when the external id is free, trimmed', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.startsWith('INSERT INTO app.contacts') ? [{ id: 'c-new' }] : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    const id = await createContact(sql as never, scope, {
      name: 'Fresh',
      externalId: '  crm-2  ',
      source: 'api_import',
    });
    expect(id).toBe('c-new');
    const insert = statements.find((s) =>
      s.text.startsWith('INSERT INTO app.contacts'),
    );
    expect(insert?.values).toContain('crm-2');
  });
});

describe('updateContact — the external id and the source', () => {
  it('writes both, and refuses an external id another live contact holds', async () => {
    const { sql, statements } = recordingSql((text) => {
      if (text.includes('FROM app.contacts WHERE id = ?')) return [existing];
      if (text.includes('external_id = ?')) return [{ id: 'c-other' }];
      return [];
    });
    let caught: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      await updateContact(sql as never, scope, 'c-1', { externalId: 'crm-9' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTACT_DUPLICATE_EXTERNAL_ID',
      status: 409,
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.contacts')),
    ).toBe(false);
  });

  it('lands a free external id and a new source on the row', async () => {
    const { sql, statements } = recordingSql((text) =>
      text.includes('FROM app.contacts WHERE id = ?') ? [existing] : [],
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
    await updateContact(sql as never, scope, 'c-1', {
      externalId: 'crm-9',
      source: 'manual_import',
    });
    const update = statements.find((s) =>
      s.text.startsWith('UPDATE app.contacts'),
    );
    expect(update?.text).toContain('external_id = ?');
    expect(update?.text).toContain('source = ?');
    expect(update?.values).toContain('crm-9');
    expect(update?.values).toContain('manual_import');
  });

  it('refuses an email another live contact holds with 409', async () => {
    const { sql, statements } = recordingSql((text) => {
      if (text.includes('FROM app.contacts WHERE id = ?')) return [existing];
      if (text.includes('email = ?')) return [{ id: 'c-other' }];
      return [];
    });
    let caught: unknown;
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tag stands in for a transaction
      await updateContact(sql as never, scope, 'c-1', {
        email: 'Other@Example.invalid',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTACT_DUPLICATE_EMAIL',
      status: 409,
    });
    expect(
      statements.some((s) => s.text.startsWith('UPDATE app.contacts')),
    ).toBe(false);
  });
});
