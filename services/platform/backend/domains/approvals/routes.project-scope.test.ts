// @vitest-environment node

/**
 * A connector-operation approval a workflow run parked on follows that run's
 * project boundary: reading it needs the run's project read access, deciding it
 * the run's project write access. A run named in metadata that resolves to no
 * run in the org fails closed (UUID knowledge is not authorization). A
 * genuinely non-run approval keeps the org-member posture.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  getApproval: vi.fn(),
  decideApproval: vi.fn(),
}));
const store = vi.hoisted(() => ({ getRun: vi.fn() }));
const visibility = vi.hoisted(() => ({ runControlAccess: vi.fn() }));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  ...service,
}));
vi.mock('../automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../automations/store.ts')>()),
  ...store,
}));
vi.mock('../automations/project-visibility.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../automations/project-visibility.ts')
  >()),
  ...visibility,
}));
vi.mock('../projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: vi.fn(async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: 'member',
    teamIds: [],
  })),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'member' } as never);
      await next();
    },
}));

import { createApprovalRoutes } from './routes.ts';
import { ApprovalError } from './service.ts';

function approval(metadata: Record<string, unknown> | null) {
  return {
    id: 'a1',
    organizationId: 'o1',
    resourceType: 'connector_operation',
    resourceId: 'r-run:node-1',
    status: 'pending',
    metadata,
  };
}
async function request(path: string, init?: RequestInit): Promise<Response> {
  return createApprovalRoutes({ sql: {} as never, auth: {} as never }).request(
    `${path}${path.includes('?') ? '&' : '?'}orgId=o1`,
    init,
  );
}
function decide(id: string): Promise<Response> {
  return request(`/${id}/decide`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'rejected' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getRun.mockImplementation(
    async (_sql: unknown, _org: string, runId: string) =>
      runId === 'r-run' ? { id: 'r-run', projectId: 'p1' } : null,
  );
  service.decideApproval.mockResolvedValue(undefined);
});

describe('approvals door — a run-bound approval follows its run project', () => {
  it('hides the card and refuses the decision when the run is unreadable [APV-R7]', async () => {
    service.getApproval.mockResolvedValue(approval({ runId: 'r-run' }));
    visibility.runControlAccess.mockResolvedValue('hidden');

    const read = await request('/a1');
    expect(read.status).toBe(404);
    const decided = await decide('a1');
    expect(decided.status).toBe(404);
    expect(service.decideApproval).not.toHaveBeenCalled();
  });

  it('lets a reader read but refuses the decision for a read-only member [APV-R7]', async () => {
    service.getApproval.mockResolvedValue(approval({ runId: 'r-run' }));
    visibility.runControlAccess.mockResolvedValue('forbidden');

    const read = await request('/a1');
    expect(read.status).toBe(200);
    const decided = await decide('a1');
    expect(decided.status).toBe(403);
    expect(await decided.json()).toMatchObject({ error: 'RBAC_FORBIDDEN' });
    expect(service.decideApproval).not.toHaveBeenCalled();
  });

  it('lets a project writer read and decide [APV-R7]', async () => {
    service.getApproval.mockResolvedValue(approval({ runId: 'r-run' }));
    visibility.runControlAccess.mockResolvedValue('ok');

    expect((await request('/a1')).status).toBe(200);
    const decided = await decide('a1');
    expect(decided.status).toBe(200);
    expect(service.decideApproval).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the named run resolves to nothing (UUID is not authority) [APV-R7]', async () => {
    service.getApproval.mockResolvedValue(approval({ runId: 'gone' }));

    const read = await request('/a1');
    expect(read.status).toBe(404);
    const decided = await decide('a1');
    expect(decided.status).toBe(404);
    expect(service.decideApproval).not.toHaveBeenCalled();
    // The project rule is never consulted for a run that does not exist.
    expect(visibility.runControlAccess).not.toHaveBeenCalled();
  });

  it('preserves the org-member posture for a genuinely non-run approval [APV-R8]', async () => {
    service.getApproval.mockResolvedValue(approval({ threadId: 't1' }));

    expect((await request('/a1')).status).toBe(200);
    const decided = await decide('a1');
    expect(decided.status).toBe(200);
    expect(service.decideApproval).toHaveBeenCalledTimes(1);
    // No run to resolve, so neither the run read nor the project rule runs.
    expect(store.getRun).not.toHaveBeenCalled();
    expect(visibility.runControlAccess).not.toHaveBeenCalled();
  });

  it('treats an organization-run approval as controllable by any member [APV-R8]', async () => {
    service.getApproval.mockResolvedValue(approval({ runId: 'r-org' }));
    store.getRun.mockResolvedValue({ id: 'r-org', projectId: null });
    visibility.runControlAccess.mockResolvedValue('ok');

    expect((await request('/a1')).status).toBe(200);
    expect((await decide('a1')).status).toBe(200);
    expect(service.decideApproval).toHaveBeenCalledTimes(1);
  });

  it.each(['task_review', 'document_record_review'])(
    'preserves the %s dedicated door when its metadata names another kind of run [APV-R10]',
    async (resourceType) => {
      service.getApproval.mockResolvedValue({
        ...approval({ runId: 'project-agent-run' }),
        resourceType,
      });
      service.decideApproval.mockRejectedValue(
        new ApprovalError(
          'APPROVAL_REQUIRES_DEDICATED_RESPOND',
          'Use the dedicated review door.',
          409,
        ),
      );

      expect((await request('/a1')).status).toBe(200);
      const decided = await decide('a1');
      expect(decided.status).toBe(409);
      expect(await decided.json()).toMatchObject({
        error: 'APPROVAL_REQUIRES_DEDICATED_RESPOND',
      });
      expect(service.decideApproval).toHaveBeenCalledTimes(1);
      expect(store.getRun).not.toHaveBeenCalled();
      expect(visibility.runControlAccess).not.toHaveBeenCalled();
    },
  );
});
