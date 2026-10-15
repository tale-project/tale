// @vitest-environment node

/**
 * A dispatch that skips a board because whoever saved it last lost the
 * right to it reads, to someone who may edit that board, as one whose save
 * would serve the board again: the editor offers its Save, and managed
 * configuration applies the declaration again, unchanged.
 */

import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadProjectOrThrow } from '../projects/service.ts';
import { readProjectDispatchConfiguration } from './dispatch-config.ts';
import { memberEditableProjects } from './edit-right.ts';

vi.mock('./edit-right.ts', () => ({ memberEditableProjects: vi.fn() }));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  loadProjectOrThrow: vi.fn(),
  assertReadable: vi.fn(),
}));

/** Development, shared with the whole organization; archived when asked. */
function development(archivedAt: number | null = null) {
  vi.mocked(loadProjectOrThrow).mockResolvedValue({
    id: 'p-dev',
    organizationId: 'org-1',
    name: 'Development',
    teamIds: [],
    archivedAt,
  } as unknown as Awaited<ReturnType<typeof loadProjectOrThrow>>);
}

/** Development's dispatch serves Billing, saved last by Ada. */
const stored: ProjectDispatch = {
  enabled: true,
  agents: ['coder'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'pool',
  sources: [{ projectId: 'p-billing' }],
};

const sql = ((strings: TemplateStringsArray) => {
  const text = strings.join('?');
  if (text.includes('FROM app.project_dispatch'))
    return Promise.resolve([
      { config: stored, updatedAt: 1, updatedBy: 'ada' },
    ]);
  if (text.includes('FROM app.projects'))
    return Promise.resolve([
      { id: 'p-billing', name: 'Billing', archived: false },
    ]);
  return Promise.resolve([]);
}) as unknown as Sql;

/** Who edits Billing now. */
function billingEditors(...userIds: string[]) {
  vi.mocked(memberEditableProjects).mockImplementation((_sql, args) =>
    Promise.resolve(
      new Set(userIds.includes(args.userId) ? args.projectIds : []),
    ),
  );
}

/** Someone who may administer Development (an organization admin), or
 * only edit it. */
const reader = (userId: string, role = 'admin') => ({
  organizationId: 'org-1',
  userId,
  role,
  teamIds: [],
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('a board served on a right that was lost is served again once someone who may edit it saves the dispatch [TASK-R72]', () => {
  it('tells someone who may edit the skipped board that saving it again serves it', async () => {
    // Ada lost the right to Billing; Bea has it.
    development();
    billingEditors('bea');
    await expect(
      readProjectDispatchConfiguration(sql, reader('bea'), 'p-dev'),
    ).resolves.toMatchObject({ servesAgain: true });
  });

  it('asks nothing of who could not serve it either, nor of a dispatch that serves every board', async () => {
    development();
    billingEditors('bea');
    expect(
      await readProjectDispatchConfiguration(sql, reader('noah'), 'p-dev'),
    ).not.toHaveProperty('servesAgain');
    billingEditors('ada', 'bea');
    expect(
      await readProjectDispatchConfiguration(sql, reader('bea'), 'p-dev'),
    ).not.toHaveProperty('servesAgain');
  });

  it('asks nothing of who may not save the dispatch: only edits Development, or finds it archived', async () => {
    billingEditors('bea');
    development();
    expect(
      await readProjectDispatchConfiguration(
        sql,
        reader('bea', 'editor'),
        'p-dev',
      ),
    ).not.toHaveProperty('servesAgain');
    development(1);
    expect(
      await readProjectDispatchConfiguration(sql, reader('bea'), 'p-dev'),
    ).not.toHaveProperty('servesAgain');
  });
});
