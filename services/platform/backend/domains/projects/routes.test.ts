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
import { Hono, type Context } from 'hono';
import { requestId } from 'hono/request-id';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';
import { appErrorHandler } from '../../error-reporting.ts';
import { appJsonBody, INVALID_JSON_MESSAGE } from '../../lib/app-json-body.ts';
import { checkUserRateLimit } from '../../lib/rate-limit.ts';

const service = vi.hoisted(() => ({
  createProject: vi.fn(),
  duplicateProject: vi.fn(),
  updateProjectIdentity: vi.fn(),
  updateProjectInstructions: vi.fn(),
  readProjectInstructionsConfiguration: vi.fn(),
  readAgentInstructionsConfiguration: vi.fn(),
  updateAgentInstructionsConfiguration: vi.fn(),
  readAgentToolsConfiguration: vi.fn(),
  updateAgentToolsConfiguration: vi.fn(),
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
const standard = vi.hoisted(() => ({
  ensureStandardAgent: vi.fn(),
  readStandardAgentAvailability: vi.fn(),
}));
vi.mock('./standard-agent.ts', () => standard);
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
  method: 'GET' | 'POST' | 'DELETE',
  route: string,
  body?: unknown,
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

describe('the standard agent’s doors — any member reads it, any reader hands it work', () => {
  it('answers the caller’s view of the standard agent, before a project id could match', async () => {
    standard.readStandardAgentAvailability.mockResolvedValue({
      enabled: true,
      available: true,
      harness: 'claude-code',
      model: 'claude-sonnet-5',
    });

    const res = await createProjectRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request('/standard-agent?orgId=o1');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: true });
    expect(standard.readStandardAgentAvailability).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', userId: 'u1' },
    );
  });

  it('adds the project’s standard agent for the caller, in a transaction', async () => {
    standard.ensureStandardAgent.mockResolvedValue({
      agentId: 'agent-standard',
      created: true,
    });

    const res = await send('POST', '/p1/standard-agent', {});

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      agentId: 'agent-standard',
      created: true,
    });
    expect(standard.ensureStandardAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1', userId: 'u1' }),
      'p1',
    );
  });

  it('answers a refusal with its own status, code and reason', async () => {
    const { ProjectError } = await import('./service.ts');
    standard.ensureStandardAgent.mockRejectedValue(
      new ProjectError('STANDARD_AGENT_UNAVAILABLE', 'No model', 409, {
        reason: 'no-model',
      }),
    );

    const res = await send('POST', '/p1/standard-agent', {});

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'STANDARD_AGENT_UNAVAILABLE',
      data: { reason: 'no-model' },
    });
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

describe('duplicate — the name is optional, its JSON is not (#3599)', () => {
  // The project routes as `app.ts` mounts them: behind the app door's one
  // JSON reader and its error handler, which answer a body that does not
  // parse with the door's 400 `INVALID_JSON`.
  function door(): Hono {
    const hono = new Hono();
    hono.onError(appErrorHandler);
    hono.use(requestId());
    hono.use('/api/app/*', appJsonBody());
    hono.route(
      '/api/app/projects',
      createProjectRoutes({ sql: {} as never, auth: {} as never }),
    );
    return hono;
  }

  async function post(route: string, body: string): Promise<Response> {
    return await door().request(
      `http://localhost/api/app/projects${route}?orgId=o1`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-duplicate',
        },
        body,
      },
    );
  }

  beforeEach(() => {
    service.duplicateProject.mockResolvedValue('p2');
  });

  it.each([
    ['a lone brace', '{'],
    ['a truncated name', '{"name":"Cop'],
    ['a body that is not JSON', 'name=Copy'],
  ])(
    'refuses %s with 400 INVALID_JSON and duplicates nothing',
    async (_name, body) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await post('/p1/duplicate', body);

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
          error: INVALID_JSON_MESSAGE,
          code: 'INVALID_JSON',
          requestId: 'req-duplicate',
        });
        // Refused after the session and membership gates, before the
        // route's own project lookup, its rate-limit charge and the copy.
        expect(service.getProjectAuthContext).not.toHaveBeenCalled();
        expect(checkUserRateLimit).not.toHaveBeenCalled();
        expect(service.duplicateProject).not.toHaveBeenCalled();
        // A client's mistake, not a defect to report.
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    },
  );

  it.each([
    ['no body', ''],
    ['only whitespace', ' \n\t'],
    ['an empty object', '{}'],
  ])('duplicates under the default name for %s', async (_name, body) => {
    const res = await post('/p1/duplicate', body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projectId: 'p2' });
    expect(service.duplicateProject).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      'p1',
      undefined,
    );
  });

  it('duplicates under the name a valid body gives', async () => {
    const res = await post('/p1/duplicate', '{"name":"Copy of P"}');

    expect(res.status).toBe(200);
    expect(service.duplicateProject).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.anything(),
      'p1',
      'Copy of P',
    );
  });

  it('refuses a name over its cap as an invalid body', async () => {
    const res = await post(
      '/p1/duplicate',
      JSON.stringify({ name: 'x'.repeat(201) }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid body' });
    expect(service.duplicateProject).not.toHaveBeenCalled();
  });

  it('answers the same lone brace on create as before', async () => {
    const res = await post('', '{');

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_JSON' });
    expect(service.createProject).not.toHaveBeenCalled();
  });
});

describe('managed instruction routes', () => {
  const hash = 'a'.repeat(64);
  const project = { projectId: 'p1', instructions: 'project policy' };
  const agent = { projectId: 'p1', agentId: 'a1', instructions: 'agent brief' };

  it.each([
    ['/p1/configuration/instructions', project],
    ['/p1/agents/a1/configuration/instructions', agent],
  ])(
    'requires a preimage and rejects unowned fields: %s',
    async (route, config) => {
      expect((await send('POST', route, { config })).status).toBe(400);
      expect(
        (await send('POST', route, { config, expectedHash: null })).status,
      ).toBe(400);
      expect(
        (
          await send('POST', route, {
            config: { ...config, secrets: ['TOKEN'] },
            expectedHash: hash,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await send('POST', route, {
            config: { ...config, projectId: 'other' },
            expectedHash: hash,
          })
        ).status,
      ).toBe(400);
      expect(service.updateProjectInstructions).not.toHaveBeenCalled();
      expect(
        service.updateAgentInstructionsConfiguration,
      ).not.toHaveBeenCalled();
    },
  );

  it('binds path identity and sends only the owned text through the serializable writer', async () => {
    expect(
      (
        await send('POST', '/p1/configuration/instructions', {
          config: project,
          expectedHash: hash,
        })
      ).status,
    ).toBe(200);
    expect(service.updateProjectInstructions).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p1',
      project.instructions,
      hash,
    );
    expect(
      (
        await send('POST', '/p1/agents/a1/configuration/instructions', {
          config: agent,
          expectedHash: hash,
        })
      ).status,
    ).toBe(200);
    expect(service.updateAgentInstructionsConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      agent,
      hash,
    );
    expect(
      (
        await send('POST', '/p1/agents/other/configuration/instructions', {
          config: agent,
          expectedHash: hash,
        })
      ).status,
    ).toBe(400);
  });
});

describe('managed tool routes [PROJ-R17]', () => {
  const path = '/p1/agents/a1/configuration/tools';
  const config = {
    projectId: 'p1',
    agentId: 'a1',
    tools: ['task_get', 'task_review'],
  };
  const expectedHash = 'a'.repeat(64);

  it('returns the native narrow view bound to both path identities', async () => {
    service.readAgentToolsConfiguration.mockResolvedValue({
      config,
      hash: expectedHash,
    });
    const response = await send('GET', path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ config, hash: expectedHash });
    expect(service.readAgentToolsConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'p1',
      'a1',
    );
  });

  it('passes canonical grants and the reviewed preimage to the native writer', async () => {
    const response = await send('POST', path, {
      config: { ...config, tools: ['task_review', 'task_get', 'task_review'] },
      expectedHash,
    });
    expect(response.status).toBe(200);
    expect(service.updateAgentToolsConfiguration).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      config,
      expectedHash,
    );
    expect(service.updateProjectAgent).not.toHaveBeenCalled();
  });

  it.each([
    { config },
    { config, expectedHash: null },
    { config, expectedHash: 'bad-hash' },
    { config: { ...config, tools: ['unknown_tool'] }, expectedHash },
    { config: { ...config, projectId: 'other' }, expectedHash },
    { config: { ...config, agentId: 'other' }, expectedHash },
    { config: { ...config, secrets: [] }, expectedHash },
    { config: { ...config, instructions: 'replace text' }, expectedHash },
    { config, expectedHash, model: 'replace model' },
  ])(
    'refuses missing preconditions, path mismatch or unowned fields: %j',
    async (body) => {
      expect((await send('POST', path, body)).status).toBe(400);
      expect(service.updateAgentToolsConfiguration).not.toHaveBeenCalled();
    },
  );
});
