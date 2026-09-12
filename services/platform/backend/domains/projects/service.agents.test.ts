// @vitest-environment node

/**
 * The two silent data-loss modes of the agent save, closed in the domain:
 * `expectedUpdatedAt` is the optimistic precondition every full replace
 * needs (409 `PROJECT_AGENT_STALE`, the current stamp beside it, nothing
 * written), and an unknown secret name is pruned only where the caller
 * asks for the dialog's rule — the machine door asks for `refuse` and gets
 * the names back (400 `PROJECT_AGENT_SECRET_UNKNOWN`). Beside them, the
 * keyset project list the door pages.
 */

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createProjectAgent,
  listProjectsPage,
  updateProjectAgent,
} from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../documents/service.ts', () => ({
  recordTrashRefusalFromJson: () => null,
}));
vi.mock('../tasks/retire.ts', () => ({ retireTasksInTx: vi.fn() }));
vi.mock('./agent-equipment.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./agent-equipment.ts')>()),
  agentModelRefusal: vi.fn(() => Promise.resolve(null)),
  agentEquipmentRefusal: vi.fn(() => Promise.resolve(null)),
}));

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null,
  createdBy: 'user-1',
};

const AGENT = {
  id: 'agent-1',
  organizationId: 'org_1',
  projectId: 'project-1',
  name: 'Reviewer',
  harness: 'claude-code',
  model: 'test-model',
  modelProvider: null,
  skills: [] as string[],
  connectors: [] as string[],
  tools: [] as string[],
  secrets: ['REVIEW_TOKEN'],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 10,
  updatedAt: 20,
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

function fakeTx(
  storedSecrets: string[] = ['REVIEW_TOKEN'],
  options: { nameTaken?: boolean } = {},
): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.project_agents WHERE id = ?')) {
      return Promise.resolve([AGENT]);
    }
    // The case-insensitive sibling lookup of the create and the update.
    if (text.includes('lower(name) = ?')) {
      return Promise.resolve(options.nameTaken ? [{ id: 'agent-2' }] : []);
    }
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (text.includes('FROM app.agent_secrets')) {
      const requested = values[1];
      return Promise.resolve(
        storedSecrets
          .filter(
            (name) => Array.isArray(requested) && requested.includes(name),
          )
          .map((name) => ({ name })),
      );
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const config = {
  agentId: 'agent-1',
  name: 'Reviewer',
  harness: 'claude-code',
  model: 'test-model',
  skills: [] as string[],
  connectors: [] as string[],
};

const updates = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('UPDATE app.project_agents'));

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * D-07: a duplicate agent name used to answer 400 — the one duplicate on
 * the machine door outside the 409 class every other "the state refuses
 * the action" answers (`PROJECT_KEY_TAKEN`, `FOLDER_NAME_TAKEN`), so a
 * client that reuses on 409 and gives up on 400 gave up on a recoverable
 * collision.
 */
describe('a duplicate agent name is the 409 every other duplicate answers', () => {
  it('refuses a create whose name another agent carries, in any case, writing nothing', async () => {
    const { tx, statements } = fakeTx(['REVIEW_TOKEN'], { nameTaken: true });
    await expect(
      createProjectAgent(tx, auth, {
        projectId: 'project-1',
        name: 'reviewer',
        harness: 'claude-code',
        model: 'test-model',
        skills: [],
        connectors: [],
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_AGENT_NAME_TAKEN',
      status: 409,
    });
    const clash = statements.find((s) => s.text.includes('lower(name) = ?'));
    expect(clash?.values).toContain('reviewer');
    expect(
      statements.some((s) =>
        s.text.startsWith('INSERT INTO app.project_agents'),
      ),
    ).toBe(false);
  });

  it('refuses a rename onto another agent’s name the same way', async () => {
    const { tx, statements } = fakeTx(['REVIEW_TOKEN'], { nameTaken: true });
    await expect(
      updateProjectAgent(tx, auth, { ...config, name: 'Other Agent' }),
    ).rejects.toMatchObject({
      code: 'PROJECT_AGENT_NAME_TAKEN',
      status: 409,
    });
    expect(updates(statements)).toEqual([]);
  });
});

describe('updateProjectAgent — the optimistic precondition', () => {
  it('refuses a stale expectedUpdatedAt with 409 and the current stamp, writing nothing', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      updateProjectAgent(tx, auth, { ...config, expectedUpdatedAt: 10 }),
    ).rejects.toMatchObject({
      code: 'PROJECT_AGENT_STALE',
      status: 409,
      data: { updatedAt: 20 },
    });
    expect(updates(statements)).toEqual([]);
  });

  it('saves when the precondition matches, and unconditionally when it is absent', async () => {
    const matching = fakeTx();
    await updateProjectAgent(matching.tx, auth, {
      ...config,
      expectedUpdatedAt: 20,
    });
    expect(updates(matching.statements)).toHaveLength(1);
    const unconditional = fakeTx();
    await updateProjectAgent(unconditional.tx, auth, config);
    expect(updates(unconditional.statements)).toHaveLength(1);
  });
});

describe('updateProjectAgent — unknown secret names', () => {
  it('prunes them by default (the dialog rule)', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectAgent(tx, auth, {
      ...config,
      secrets: ['REVIEW_TOKEN', 'NO_SUCH_SECRET'],
    });
    const update = updates(statements)[0];
    expect(update?.values).toContainEqual(['REVIEW_TOKEN']);
  });

  it('refuses them by name when asked to, writing nothing', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      updateProjectAgent(tx, auth, {
        ...config,
        secrets: ['REVIEW_TOKEN', 'NO_SUCH_SECRET', 'ANOTHER'],
        unknownSecrets: 'refuse',
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_AGENT_SECRET_UNKNOWN',
      status: 400,
      data: { secrets: ['NO_SUCH_SECRET', 'ANOTHER'] },
    });
    expect(updates(statements)).toEqual([]);
  });

  it('accepts a grant of only stored names under refuse', async () => {
    const { tx, statements } = fakeTx();
    await updateProjectAgent(tx, auth, {
      ...config,
      secrets: ['REVIEW_TOKEN'],
      unknownSecrets: 'refuse',
    });
    expect(updates(statements)).toHaveLength(1);
  });
});

describe('listProjectsPage', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, index) => ({
      ...PROJECT,
      id: `p-${index}`,
      createdAt: 1000 - index,
      updatedAt: 1000 - index,
    }));

  function fakeSql(answer: object[]): { sql: Sql; statements: Statement[] } {
    const statements: Statement[] = [];
    const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values });
      return Promise.resolve(text.includes('ORDER BY') ? answer : []);
    };
    const sql = Object.assign(run, { unsafe: (text: string) => text });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js root instance
    return { sql: sql as unknown as Sql, statements };
  }

  it('asks one row past the page and reports whether more remain', async () => {
    const { sql, statements } = fakeSql(rows(3));
    const page = await listProjectsPage(sql, auth, {
      archived: 'exclude',
      limit: 2,
      cursor: null,
    });
    expect(page.projects.map((p) => p.id)).toEqual(['p-0', 'p-1']);
    expect(page.hasMore).toBe(true);
    const listing = statements.find((s) => s.text.includes('ORDER BY'));
    expect(listing?.text).toContain(
      'ORDER BY created_at_ms DESC, id DESC LIMIT ?',
    );
    expect(listing?.values.at(-1)).toBe(3);
    // (columns, org_id, include, only, exclude, …): exclude is the live branch.
    expect(listing?.values.slice(2, 5)).toEqual([false, false, true]);
    const done = await listProjectsPage(fakeSql(rows(2)).sql, auth, {
      archived: 'only',
      limit: 2,
      cursor: null,
    });
    expect(done.hasMore).toBe(false);
  });

  it('carries the archived filter and the keyset cursor into the query', async () => {
    const { sql, statements } = fakeSql([]);
    await listProjectsPage(sql, auth, {
      archived: 'only',
      limit: 10,
      cursor: { at: 500, id: 'p-7' },
    });
    const listing = statements.find((s) => s.text.includes('ORDER BY'));
    expect(listing?.values.slice(2, 5)).toEqual([false, true, false]);
    expect(listing?.values).toEqual(expect.arrayContaining([500, 'p-7']));
  });
});
