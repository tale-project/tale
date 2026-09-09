// @vitest-environment node

/**
 * The project key and external id as the API reference describes them. The
 * regressions under test: an explicit key was normalized in silence
 * (`TOOLONGKEY` landed as `TOOLON`, `my key` as `MYKEY`); a name no key can
 * be derived from was refused with a message about a key the caller never
 * sent (the spec promises a keyless project); and the two duplicate
 * refusals answered 400 where the reference and the OpenAPI promise 409.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProject, ProjectError } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../documents/service.ts', () => ({
  recordTrashRefusalFromJson: () => null,
}));
vi.mock('../tasks/retire.ts', () => ({ retireTasksInTx: vi.fn() }));

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

type Statement = { text: string; values: unknown[] };

function fakeTx(world: { takenKeys?: string[]; externalIds?: string[] } = {}) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('WHERE org_id = ? AND key = ?')) {
      return Promise.resolve(
        (world.takenKeys ?? []).includes(String(values[1]))
          ? [{ id: 'p-taken' }]
          : [],
      );
    }
    if (text.includes('external_item_id = ?')) {
      return Promise.resolve(
        (world.externalIds ?? []).includes(String(values[1]))
          ? [{ id: 'p-taken' }]
          : [],
      );
    }
    if (text.startsWith('INSERT INTO app.projects')) {
      return Promise.resolve([{ id: 'p-new' }]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const insertedKey = (statements: Statement[]): unknown => {
  const insert = statements.find((s) =>
    s.text.startsWith('INSERT INTO app.projects'),
  );
  // (org_id, name, key, …) — the key is the third value.
  return insert?.values[2];
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('createProject — the key', () => {
  it('derives a key from a Latin name', async () => {
    const { tx, statements } = fakeTx();
    await createProject(tx, auth, { name: 'ACME Ltd' });
    expect(insertedKey(statements)).toBe('AL');
  });

  it('creates a project keyless when the name yields no key', async () => {
    const { tx, statements } = fakeTx();
    const id = await createProject(tx, auth, { name: '日本語だけ' });
    expect(id).toBe('p-new');
    expect(insertedKey(statements)).toBeNull();
  });

  it('upper-cases an explicit key but never strips or truncates it', async () => {
    const { tx, statements } = fakeTx();
    await createProject(tx, auth, { name: 'ACME Ltd', key: 'abc' });
    expect(insertedKey(statements)).toBe('ABC');
    await expect(
      createProject(fakeTx().tx, auth, { name: 'ACME Ltd', key: 'TOOLONGKEY' }),
    ).rejects.toMatchObject({ code: 'PROJECT_KEY_INVALID', status: 400 });
    await expect(
      createProject(fakeTx().tx, auth, { name: 'ACME Ltd', key: 'my key' }),
    ).rejects.toMatchObject({ code: 'PROJECT_KEY_INVALID', status: 400 });
  });

  it('answers a taken explicit key with 409', async () => {
    const { tx } = fakeTx({ takenKeys: ['APP'] });
    let caught: unknown;
    try {
      await createProject(tx, auth, { name: 'ACME Ltd', key: 'APP' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectError);
    expect(caught).toMatchObject({ code: 'PROJECT_KEY_TAKEN', status: 409 });
  });
});

describe('createProject — the external item id', () => {
  it('answers a duplicate with 409 and creates nothing', async () => {
    const { tx, statements } = fakeTx({ externalIds: ['crm-4711'] });
    await expect(
      createProject(tx, auth, { name: 'ACME Ltd', externalItemId: 'crm-4711' }),
    ).rejects.toMatchObject({
      code: 'PROJECT_DUPLICATE_EXTERNAL_ID',
      status: 409,
    });
    expect(statements.some((s) => s.text.startsWith('INSERT'))).toBe(false);
  });
});
