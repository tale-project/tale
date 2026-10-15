// @vitest-environment node

/**
 * A project's dispatch over the settings tools is planned as the save
 * checks it (`dispatch-config.ts`): against the stored document, so a board
 * kept as stored and switching dispatch off are judged as the save judges
 * them, and the same document still changes something while saving it
 * again serves a board it skips now.
 */

import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpCaller } from '../mcp/caller.ts';
import type { SettingsContext } from '../mcp/settings/registry.ts';
import { checkProjectDispatch, savingServesAgain } from './dispatch-config.ts';
import { readDispatchPreimage } from './dispatch-store.ts';
import { projectDispatchSettings } from './settings-resource.ts';

vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: async (
    _sql: unknown,
    member: { organizationId: string; userId: string; role: string },
  ) => ({ ...member, teamIds: [] }),
  loadProjectOrThrow: async (_sql: unknown, id: string) => ({
    id,
    organizationId: 'org-1',
    teamIds: [],
    archivedAt: null,
  }),
}));
vi.mock('./dispatch-config.ts', async (original) => ({
  ...(await original<typeof import('./dispatch-config.ts')>()),
  checkProjectDispatch: vi.fn(),
  savingServesAgain: vi.fn(),
}));
vi.mock('./dispatch-store.ts', async (original) => ({
  ...(await original<typeof import('./dispatch-store.ts')>()),
  readDispatchPreimage: vi.fn(),
}));

/** Development's dispatch, serving Billing, as Ada saved it last. */
const stored: ProjectDispatch = {
  enabled: true,
  agents: ['coder'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'pool',
  sources: [{ projectId: 'p-billing' }],
};

function contextOf(): SettingsContext {
  const caller: McpCaller = {
    organizationId: 'org-1',
    orgSlug: 'acme',
    userId: 'bea',
    role: 'admin',
    credential: { kind: 'api-key', apiKeyId: 'key-laptop' },
  };
  // The caller's address; every other read is mocked above.
  const tag = async () => [{ email: 'bea@example.test' }];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: tag as unknown as Sql, caller };
}

const change = (dispatch: ProjectDispatch) => ({
  kind: 'project-dispatch' as const,
  id: 'p-dev',
  op: 'set' as const,
  config: { projectId: 'p-dev', ...dispatch },
});

const current = {
  id: 'p-dev',
  config: { projectId: 'p-dev', ...stored },
  hash: 'stored-hash',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readDispatchPreimage).mockResolvedValue({
    config: stored,
    updatedAt: 1,
    updatedBy: 'ada',
  } as Awaited<ReturnType<typeof readDispatchPreimage>>);
  vi.mocked(checkProjectDispatch).mockResolvedValue([]);
  vi.mocked(savingServesAgain).mockResolvedValue(false);
});

describe('a dispatch over the settings tools is planned as the save checks it', () => {
  it('judges the change against the stored document, so a board kept as stored is not checked again [TASK-R70]', async () => {
    const plan = await projectDispatchSettings.plan(
      contextOf(),
      change({ ...stored, enabled: false }),
      current,
    );
    expect(checkProjectDispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-dev', stored }),
    );
    expect(plan).toMatchObject({ unchanged: false });
  });

  it('applies the same document again while saving it serves a skipped board on the caller’s right [TASK-R72]', async () => {
    const ctx = contextOf();
    expect(
      await projectDispatchSettings.plan(ctx, change(stored), current),
    ).toMatchObject({ unchanged: true });
    vi.mocked(savingServesAgain).mockResolvedValue(true);
    expect(
      await projectDispatchSettings.plan(ctx, change(stored), current),
    ).toMatchObject({ unchanged: false });
  });
});
