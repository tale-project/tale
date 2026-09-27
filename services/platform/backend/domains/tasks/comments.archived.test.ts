// @vitest-environment node

/**
 * An archived project is read-only, its task discussions included. The REST
 * comment door refused with `PROJECT_ARCHIVED` while the app door (and the
 * ask-answer mirrors) went straight through `addTaskComment`, which gated
 * on readability alone — so a comment could still land on an archived
 * project's task from the app.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadProjectOrThrow, loadTaskOrThrow } = vi.hoisted(() => ({
  loadProjectOrThrow: vi.fn(),
  loadTaskOrThrow: vi.fn(),
}));

vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow,
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  loadTaskOrThrow,
}));

import { addTaskComment } from './comments.ts';

function fakeTx(): { tx: TransactionSql; statements: string[] } {
  const statements: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised
  return { tx: tag as unknown as TransactionSql, statements };
}

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

const project = {
  id: 'proj-1',
  organizationId: 'org_1',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: 1_700_000_000_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  loadTaskOrThrow.mockResolvedValue({
    id: 'task-1',
    organizationId: 'org_1',
    projectId: 'proj-1',
    archivedAt: null,
  });
  loadProjectOrThrow.mockResolvedValue(project);
});

describe('addTaskComment on an archived project', () => {
  it('refuses with 403 PROJECT_ARCHIVED after the reads, writing nothing', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      addTaskComment(tx, auth, { taskId: 'task-1', body: 'hello' }),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED', status: 403 });
    // The queue lock is the only statement: no thread, message or meta row.
    expect(
      statements.filter((s) => !s.startsWith('SELECT pg_advisory')),
    ).toEqual([]);
  });
});
