// @vitest-environment node

/**
 * An archived project is read-only everywhere — its documents, comments and
 * automations already answered PROJECT_ARCHIVED, but its secrets could still
 * be set, paired and deleted (2026-09-26 evaluation, C-10). Every secrets
 * write now passes the same gate; the metadata listing stays readable.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteProjectSecret,
  listProjectSecrets,
  setProjectSecret,
  setProjectSecretPair,
} from './secrets.ts';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../../core/lib/secret_box.ts', () => ({
  encryptSecret: (value: string) => ({ v: 1, ct: `enc(${value})` }),
}));

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  externalItemId: null,
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
  createdBy: 'user-1',
};

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(options: { archived?: boolean } = {}): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([
        options.archived
          ? { ...PROJECT, archivedAt: 1_700_000_000_000 }
          : PROJECT,
      ]);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

function writes(statements: Statement[]): Statement[] {
  return statements.filter((s) => /^(INSERT|UPDATE|DELETE)/.test(s.text));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('project secrets on an archived project', () => {
  it('refuses a set with PROJECT_ARCHIVED, writing nothing', async () => {
    const { tx, statements } = fakeTx({ archived: true });
    await expect(
      setProjectSecret(tx, auth, {
        projectId: 'project-1',
        name: 'API_KEY',
        value: 'v',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(writes(statements)).toHaveLength(0);
  });

  it('refuses a pair write with PROJECT_ARCHIVED, writing nothing', async () => {
    const { tx, statements } = fakeTx({ archived: true });
    await expect(
      setProjectSecretPair(tx, auth, {
        projectId: 'project-1',
        baseName: 'SMTP',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(writes(statements)).toHaveLength(0);
  });

  it('refuses a delete with PROJECT_ARCHIVED, writing nothing', async () => {
    const { tx, statements } = fakeTx({ archived: true });
    await expect(
      deleteProjectSecret(tx, auth, {
        projectId: 'project-1',
        name: 'API_KEY',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    expect(writes(statements)).toHaveLength(0);
  });

  it('still lists the metadata (the archived project stays readable)', async () => {
    const { tx, statements } = fakeTx({ archived: true });
    await expect(listProjectSecrets(tx, auth, 'project-1')).resolves.toEqual(
      [],
    );
    expect(
      statements.some((s) => s.text.includes('FROM app.project_secrets')),
    ).toBe(true);
  });
});

describe('project secrets on an active project', () => {
  it('writes the row for an administrator', async () => {
    const { tx, statements } = fakeTx();
    await setProjectSecret(tx, auth, {
      projectId: 'project-1',
      name: 'api_key',
      value: 'v',
    });
    const inserts = writes(statements);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toContain('API_KEY');
  });

  it('still refuses a non-administrator with PROJECT_FORBIDDEN', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      setProjectSecret(
        tx,
        { ...auth, role: 'member' },
        { projectId: 'project-1', name: 'API_KEY', value: 'v' },
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_FORBIDDEN', status: 403 });
    expect(writes(statements)).toHaveLength(0);
  });
});
