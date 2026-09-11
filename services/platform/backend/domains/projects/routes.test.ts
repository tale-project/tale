// @vitest-environment node

/**
 * The project routes parse every body with the SHARED project schemas
 * (`@tale/shared/schemas/projects`). Before this the door carried a looser
 * hand copy — `icon: z.string().max(100)`, `color: z.string().max(50)`, a
 * 200-char name cap against the shared 80 — so any client could persist an
 * icon the avatar cannot render or a colour outside the token palette while
 * the shared file claimed "server-enforced via Zod". This pins the door on
 * the shared shapes: the allowlists refuse, the caps are the shared caps,
 * and the null-clears the service supports still get through.
 */

import {
  PROJECT_AGENT_BINDINGS_MAX,
  PROJECT_AGENT_MODEL_MAX,
  PROJECT_AGENT_NAME_MAX,
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  PROJECT_NAME_MAX,
} from '@tale/shared/schemas/projects';
import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const service = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProjectIdentity: vi.fn(),
  updateProjectInstructions: vi.fn(),
  deleteProject: vi.fn(),
  getProjectAuthContext: vi.fn(),
  assertCanCreateProjects: vi.fn(),
  createProjectAgent: vi.fn(),
  updateProjectAgent: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return { ...actual, ...service };
});
vi.mock('./secrets.ts', () => ({
  deleteProjectSecret: vi.fn(),
  listProjectSecrets: vi.fn(),
  setProjectSecret: vi.fn(),
  setProjectSecretPair: vi.fn(),
}));
vi.mock('../tasks/service.ts', () => ({
  ensureDefaultProjectLabels: vi.fn(),
}));
vi.mock('../../lib/rate-limit.ts', () => ({
  checkUserRateLimit: vi.fn(),
  RateLimitExceededError: class extends Error {},
}));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (_sql: unknown, fn: (tx: unknown) => unknown) => fn({}),
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
vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { createProjectRoutes } from './routes.ts';

async function send(
  method: 'POST' | 'DELETE',
  route: string,
  body: unknown,
): Promise<Response> {
  return await createProjectRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request(`${route}?orgId=o1`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  service.getProjectAuthContext.mockResolvedValue({
    organizationId: 'o1',
    userId: 'u1',
    role: 'admin',
    teamIds: [],
  });
  service.createProject.mockResolvedValue('p1');
  service.createProjectAgent.mockResolvedValue('a1');
});

describe('project agent session routes share REST configuration limits', () => {
  const agent = {
    name: 'Reviewer',
    harness: 'claude-code',
    model: 'test-model',
    skills: [],
    connectors: [],
  };

  it.each([
    { name: 'a'.repeat(PROJECT_AGENT_NAME_MAX + 1) },
    { model: 'm'.repeat(PROJECT_AGENT_MODEL_MAX + 1) },
    {
      skills: Array.from(
        { length: PROJECT_AGENT_BINDINGS_MAX + 1 },
        (_, i) => `skill-${i}`,
      ),
    },
  ])(
    'refuses oversized configuration on create and update: %j',
    async (fields) => {
      expect(
        (await send('POST', '/p1/agents', { ...agent, ...fields })).status,
      ).toBe(400);
      expect(
        (await send('POST', '/agents/a1', { ...agent, ...fields })).status,
      ).toBe(400);
      expect(service.createProjectAgent).not.toHaveBeenCalled();
      expect(service.updateProjectAgent).not.toHaveBeenCalled();
    },
  );

  it('forwards valid configuration with its project path', async () => {
    expect((await send('POST', '/p1/agents', agent)).status).toBe(200);
    expect(service.createProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { ...agent, projectId: 'p1' },
    );
  });
});

describe('project routes — the shared schemas guard the door', () => {
  it('refuses an icon or colour outside the shared allowlists', async () => {
    const badIcon = await send('POST', '/', { name: 'P', icon: 'NotAnIcon' });
    const badColor = await send('POST', '/', { name: 'P', color: '#10b981' });
    expect(badIcon.status).toBe(400);
    expect(badColor.status).toBe(400);
    expect(service.createProject).not.toHaveBeenCalled();
  });

  it('lets an allowlisted icon and colour through to the service', async () => {
    const res = await send('POST', '/', {
      name: 'P',
      icon: 'Rocket',
      color: 'emerald',
      key: 'PRJ',
    });
    expect(res.status).toBe(200);
    expect(service.createProject).toHaveBeenCalledTimes(1);
    expect(service.createProject.mock.calls[0]?.[2]).toMatchObject({
      name: 'P',
      icon: 'Rocket',
      color: 'emerald',
      key: 'PRJ',
    });
  });

  it('applies the shared name cap, not the old 200-char hand copy', async () => {
    const res = await send('POST', '/', {
      name: 'x'.repeat(PROJECT_NAME_MAX + 1),
    });
    expect(res.status).toBe(400);
    expect(service.createProject).not.toHaveBeenCalled();
  });

  it('keeps the null-clears of the identity write', async () => {
    const res = await send('POST', '/p1/identity', {
      description: null,
      icon: null,
      color: null,
    });
    expect(res.status).toBe(200);
    expect(service.updateProjectIdentity.mock.calls[0]?.[2]).toEqual({
      projectId: 'p1',
      description: null,
      icon: null,
      color: null,
    });
  });

  it('caps instructions at the shared constant', async () => {
    const over = await send('POST', '/p1/instructions', {
      instructions: 'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS + 1),
    });
    expect(over.status).toBe(400);
    const atCap = await send('POST', '/p1/instructions', {
      instructions: 'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS),
    });
    expect(atCap.status).toBe(200);
    expect(service.updateProjectInstructions).toHaveBeenCalledTimes(1);
  });

  it('refuses a cascade delete with no confirm phrase at the door', async () => {
    const res = await send('DELETE', '/p1', { mode: 'cascade' });
    expect(res.status).toBe(400);
    expect(service.deleteProject).not.toHaveBeenCalled();
  });
});
