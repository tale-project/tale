// @vitest-environment node

/**
 * D-06: a project's `externalItemId` had no update path — the key a mirror
 * looks the project up by was immutable for its life, so a re-numbered
 * source record left delete-and-recreate as the only move. The re-key is
 * a settings mutation like the rename: canonical key, unique within the
 * organization (another project's key is the 409 with the key beside it),
 * `null` releases it, an unchanged key writes nothing.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateProjectExternalItemId } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  externalItemId: 'crm-1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
  createdBy: 'user-1',
};

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [] as string[],
};

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(options: { takenBy?: string } = {}): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    // The uniqueness lookup (its `AND id <> ?` exclusion is a fragment —
    // a tagged-template call of its own, recorded as one statement).
    if (text.includes('external_item_id = ?')) {
      return Promise.resolve(
        options.takenBy === undefined ? [] : [{ id: options.takenBy }],
      );
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const writes = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('UPDATE app.projects'));

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateProjectExternalItemId', () => {
  it('stores the canonical key — NFC-composed, trimmed — and audits the change', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectExternalItemId(tx, auth, {
      projectId: 'project-1',
      externalItemId: ' crm-2́ ',
    });
    const [update] = writes(statements);
    expect(update?.values).toContain('crm-2́'.normalize('NFC'));
    const { createAuditLog } = await import('../audit_logs/service.ts');
    expect(vi.mocked(createAuditLog)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        previousState: { externalItemId: 'crm-1' },
        newState: { externalItemId: 'crm-2́'.normalize('NFC') },
        changedFields: ['externalItemId'],
      }),
    );
  });

  it('releases the key with null', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectExternalItemId(tx, auth, {
      projectId: 'project-1',
      externalItemId: null,
    });
    const [update] = writes(statements);
    expect(update?.values[0]).toBeNull();
  });

  it('writes nothing for the key the project already carries', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectExternalItemId(tx, auth, {
      projectId: 'project-1',
      externalItemId: '  crm-1 ',
    });
    expect(writes(statements)).toEqual([]);
    const { createAuditLog } = await import('../audit_logs/service.ts');
    expect(vi.mocked(createAuditLog)).not.toHaveBeenCalled();
  });

  it('refuses another project’s key with 409 and the key beside it, writing nothing', async () => {
    const { tx, statements } = fakeTx({ takenBy: 'project-9' });
    await expect(
      updateProjectExternalItemId(tx, auth, {
        projectId: 'project-1',
        externalItemId: 'crm-9',
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_DUPLICATE_EXTERNAL_ID',
      status: 409,
      data: { externalItemId: 'crm-9' },
    });
    // The lookup excluded the project's own row.
    expect(
      statements.some(
        (s) => s.text === 'AND id <> ?' && s.values.includes('project-1'),
      ),
    ).toBe(true);
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a key that is blank or too long once canonical, and a caller without edit access', async () => {
    const { tx } = fakeTx();
    await expect(
      updateProjectExternalItemId(tx, auth, {
        projectId: 'project-1',
        externalItemId: 'x'.repeat(257),
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_EXTERNAL_ITEM_ID_INVALID',
      status: 400,
    });
    await expect(
      updateProjectExternalItemId(
        tx,
        { ...auth, role: 'member' },
        { projectId: 'project-1', externalItemId: 'crm-3' },
      ),
    ).rejects.toMatchObject({ code: 'RBAC_FORBIDDEN', status: 403 });
  });
});
