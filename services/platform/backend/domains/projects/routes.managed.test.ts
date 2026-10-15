// @vitest-environment node

/**
 * The managed configuration doors of a project and a project agent
 * (`…/configuration/project`, `…/agents/{agentId}/configuration/agent`): a
 * body names the resource its path names, a creation names a stable UUID,
 * and only then does the writer run, in a serializable transaction.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const managed = vi.hoisted(() => ({
  readManagedProject: vi.fn(),
  readManagedProjectAgent: vi.fn(),
  writeManagedProject: vi.fn(),
  writeManagedProjectAgent: vi.fn(),
}));
const getProjectAuthContext = vi.hoisted(() => vi.fn());

vi.mock('./managed-entities.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managed-entities.ts')>()),
  ...managed,
}));
vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  getProjectAuthContext,
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (_sql: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'ada', email: 'ada@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'org-1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createProjectRoutes } from './routes.ts';

const PROJECT = '6f1c2a14-4d55-4d61-9b2a-7a5c2e0f3b11';
const AGENT = '0c3d5e8a-1b2c-4d3e-8f9a-0b1c2d3e4f50';
const ada = {
  organizationId: 'org-1',
  userId: 'ada',
  role: 'admin',
  teamIds: [],
};

function send(method: 'GET' | 'POST', route: string, body?: unknown) {
  return createProjectRoutes({ sql: {} as never, auth: {} as never }).request(
    route,
    {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAuthContext.mockResolvedValue(ada);
  managed.readManagedProject.mockResolvedValue({ config: null, hash: null });
  managed.readManagedProjectAgent.mockResolvedValue({
    config: null,
    hash: null,
  });
});

describe('the managed door of a project [PROJ-R21]', () => {
  const project = (projectId: string) => ({
    config: { projectId, name: 'Fleet' },
    expectedHash: null,
    createIfMissing: true,
    key: 'FLT',
  });

  it('reads the project its path names, as absent only for a declaration that may create it', async () => {
    expect(
      (
        await send(
          'GET',
          `/${PROJECT}/configuration/project?createIfMissing=true`,
        )
      ).status,
    ).toBe(200);
    expect(managed.readManagedProject).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      PROJECT,
      true,
    );
    expect(
      (
        await send(
          'GET',
          `/${PROJECT}/configuration/project?createIfMissing=yes`,
        )
      ).status,
    ).toBe(400);
  });

  it('writes only the project its path names, and creates only under a UUID', async () => {
    expect(
      (
        await send(
          'POST',
          `/${PROJECT}/configuration/project`,
          project('6f1c2a14-0000-4d61-9b2a-7a5c2e0f3b11'),
        )
      ).status,
    ).toBe(400);
    expect(
      (await send('POST', '/fleet/configuration/project', project('fleet')))
        .status,
    ).toBe(400);
    expect(managed.writeManagedProject).not.toHaveBeenCalled();
    expect(
      (
        await send(
          'POST',
          `/${PROJECT}/configuration/project`,
          project(PROJECT),
        )
      ).status,
    ).toBe(200);
    expect(managed.writeManagedProject).toHaveBeenCalledWith(
      {},
      ada,
      project(PROJECT),
    );
  });
});

describe('the managed door of a project agent [PROJ-R22]', () => {
  const agent = (agentId: string) => ({
    config: { projectId: PROJECT, agentId, name: 'Manager' },
    expectedHash: null,
    createIfMissing: true,
    seed: {
      harness: 'codex',
      model: 'example-model',
      modelProvider: 'example',
    },
  });

  it('writes only the agent its path names, and creates only under a UUID', async () => {
    expect(
      (
        await send(
          'POST',
          `/${PROJECT}/agents/${AGENT}/configuration/agent`,
          agent('0c3d5e8a-0000-4d3e-8f9a-0b1c2d3e4f50'),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await send(
          'POST',
          `/${PROJECT}/agents/manager/configuration/agent`,
          agent('manager'),
        )
      ).status,
    ).toBe(400);
    expect(managed.writeManagedProjectAgent).not.toHaveBeenCalled();
    expect(
      (
        await send(
          'POST',
          `/${PROJECT}/agents/${AGENT}/configuration/agent`,
          agent(AGENT),
        )
      ).status,
    ).toBe(200);
    expect(managed.writeManagedProjectAgent).toHaveBeenCalledWith(
      {},
      ada,
      agent(AGENT),
    );
  });

  it('reads the agent its path names', async () => {
    expect(
      (
        await send(
          'GET',
          `/${PROJECT}/agents/${AGENT}/configuration/agent?createIfMissing=true`,
        )
      ).status,
    ).toBe(200);
    expect(managed.readManagedProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      ada,
      PROJECT,
      AGENT,
      true,
    );
  });
});
