// @vitest-environment node

import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectError } from '../domains/projects/service.ts';
import type { RestEnv } from './shared.ts';
import { createProjectRestRoutes } from './v1-projects.ts';

const service = vi.hoisted(() => ({
  listProjectAgents: vi.fn(),
  getProjectAgent: vi.fn(),
  createProjectAgent: vi.fn(),
  updateProjectAgent: vi.fn(),
  deleteProjectAgent: vi.fn(),
}));

vi.mock('../domains/projects/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/projects/service.ts')>()),
  ...service,
}));

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  teamId: 'team-1',
  sharedWithTeamIds: [],
  archivedAt: null,
};
const input = {
  name: 'Reviewer',
  harness: 'claude-code',
  model: 'test-model',
  modelProvider: 'provider-1',
  skills: ['review'],
  connectors: ['github'],
  tools: ['project:tasks:list'],
  secrets: ['REVIEW_TOKEN'],
  instructions: 'Review the assigned task.',
};
const agent = {
  id: 'a-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  ...input,
  createdBy: 'user-1',
  createdAt: 10,
  updatedAt: 20,
};

function mount(
  options: {
    role?: string;
    teamIds?: string[];
    foreign?: boolean;
    absent?: boolean;
    archived?: boolean;
    ambiguous?: boolean;
  } = {},
) {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.projects')) {
      return Promise.resolve(
        options.absent
          ? []
          : [
              {
                ...project,
                organizationId: options.foreign ? 'other-org' : 'org-1',
                archivedAt: options.archived ? 1 : null,
              },
            ],
      );
    }
    if (text.includes('FROM "teamMember"')) {
      return Promise.resolve(
        (options.teamIds ?? ['team-1']).map((teamId) => ({ teamId })),
      );
    }
    if (text.includes('FROM "member"')) {
      return Promise.resolve([
        { organizationId: 'org-1', role: 'admin' },
        { organizationId: 'org-2', role: 'admin' },
      ]);
    }
    return Promise.resolve([]);
  };
  const begin = vi.fn(
    (_options: string, callback: (tx: TransactionSql) => Promise<unknown>) =>
      callback(sql as unknown as TransactionSql),
  );
  const sql = Object.assign(tag, {
    unsafe: (value: string) => value,
    begin,
  }) as unknown as Sql;
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('organizationId', 'org-1');
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('role', options.role ?? 'admin');
    c.set('orgSlug', 'acme');
    c.set('orgExplicit', !options.ambiguous);
    c.set('clientIp', '127.0.0.1');
    return next();
  });
  app.route('/', createProjectRestRoutes({ sql }));
  return { app, begin };
}

const send = (
  app: Hono<RestEnv>,
  method: string,
  path: string,
  body?: unknown,
) =>
  app.request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  service.listProjectAgents.mockResolvedValue([agent]);
  service.getProjectAgent.mockResolvedValue(agent);
  service.createProjectAgent.mockResolvedValue('a-1');
  service.updateProjectAgent.mockResolvedValue(undefined);
  service.deleteProjectAgent.mockResolvedValue(undefined);
});

describe('REST project agents use project resources and permissions', () => {
  it('lists and reads the project records, including their project id', async () => {
    const { app } = mount();
    const list = await send(app, 'GET', '/projects/p-1/agents');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ agents: [agent] });
    const read = await send(app, 'GET', '/projects/p-1/agents/a-1');
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ agent });
    expect(service.getProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1' }),
      'p-1',
      'a-1',
    );
  });

  it('creates through the existing service in a serializable transaction', async () => {
    const { app, begin } = mount();
    const response = await send(app, 'POST', '/projects/p-1/agents', input);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ agent });
    expect(begin).toHaveBeenCalledWith(
      'isolation level serializable',
      expect.any(Function),
    );
    expect(service.createProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-1' }),
      { ...input, projectId: 'p-1', unknownSecrets: 'refuse' },
    );
  });

  it('saves full project-agent configuration with PUT', async () => {
    const { app } = mount();
    const response = await send(app, 'PUT', '/projects/p-1/agents/a-1', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agent });
    expect(service.updateProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { ...input, agentId: 'a-1', unknownSecrets: 'refuse' },
    );
  });

  it('deletes the matched project agent through the shared service', async () => {
    const { app } = mount();
    const response = await send(app, 'DELETE', '/projects/p-1/agents/a-1');
    expect(response.status).toBe(204);
    expect(service.deleteProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'a-1',
    );
  });

  it.each(['GET', 'PUT', 'DELETE'])(
    '%s refuses an agent outside the named project before mutation',
    async (method) => {
      service.getProjectAgent.mockResolvedValue(null);
      const { app } = mount();
      const response = await send(
        app,
        method,
        '/projects/p-1/agents/a-foreign',
        method === 'PUT' ? input : undefined,
      );
      expect(response.status).toBe(404);
      expect(service.updateProjectAgent).not.toHaveBeenCalled();
      expect(service.deleteProjectAgent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { foreign: true },
    { absent: true },
    { role: 'editor', teamIds: [] },
  ])('hides inaccessible projects: %j', async (options) => {
    const { app } = mount(options);
    expect((await send(app, 'GET', '/projects/p-1/agents')).status).toBe(404);
    expect(
      (await send(app, 'POST', '/projects/p-1/agents', input)).status,
    ).toBe(404);
    expect(service.listProjectAgents).not.toHaveBeenCalled();
    expect(service.createProjectAgent).not.toHaveBeenCalled();
  });

  it('allows project readers to list but refuses writes', async () => {
    const { app } = mount({ role: 'member' });
    expect((await send(app, 'GET', '/projects/p-1/agents')).status).toBe(200);
    expect(
      (await send(app, 'POST', '/projects/p-1/agents', input)).status,
    ).toBe(403);
    expect(service.createProjectAgent).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'DELETE'])(
    '%s refuses writes to an archived project',
    async (method) => {
      const { app } = mount({ archived: true });
      const path = '/projects/p-1/agents' + (method === 'POST' ? '' : '/a-1');
      expect(
        (await send(app, method, path, method === 'DELETE' ? undefined : input))
          .status,
      ).toBe(403);
      expect(service.createProjectAgent).not.toHaveBeenCalled();
      expect(service.updateProjectAgent).not.toHaveBeenCalled();
      expect(service.deleteProjectAgent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { displayName: 'Old persona', visibility: 'org' },
    { ...input, projectId: 'other-project' },
    { ...input, agentId: 'other-agent' },
    {
      ...input,
      skills: Array.from({ length: 26 }, (_, index) => `skill-${index}`),
    },
    { ...input, model: '' },
    { ...input, name: 'x'.repeat(121) },
  ])('refuses an invalid or contradictory body: %j', async (body) => {
    const { app } = mount();
    expect((await send(app, 'POST', '/projects/p-1/agents', body)).status).toBe(
      400,
    );
    expect(service.createProjectAgent).not.toHaveBeenCalled();
  });

  it('maps the existing secret-grant refusal without writing a substitute resource', async () => {
    service.createProjectAgent.mockRejectedValue(
      new ProjectError(
        'PROJECT_AGENT_SECRETS_FORBIDDEN',
        'Only admins can change agent secrets',
        403,
      ),
    );
    const { app } = mount({ role: 'editor' });
    const response = await send(app, 'POST', '/projects/p-1/agents', input);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'PROJECT_AGENT_SECRETS_FORBIDDEN',
    });
  });
});

/**
 * The two silent data-loss modes of a full replace, closed: the save takes
 * the optimistic precondition the other families take (`expectedUpdatedAt`
 * → 409 `PROJECT_AGENT_STALE` from the domain, `data.updatedAt` beside
 * it), and an unknown secret NAME is refused by name on this door
 * (`unknownSecrets: 'refuse'` → 400 `PROJECT_AGENT_SECRET_UNKNOWN`) where
 * the app dialog prunes it. A name of only whitespace is refused at the
 * door, never stored.
 */
describe('REST project agents — precondition and secret grants', () => {
  it('hands the precondition to the domain on PUT only, and refuses a fractional one', async () => {
    const { app } = mount();
    const saved = await send(app, 'PUT', '/projects/p-1/agents/a-1', {
      ...input,
      expectedUpdatedAt: 20,
    });
    expect(saved.status).toBe(200);
    expect(service.updateProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        ...input,
        agentId: 'a-1',
        unknownSecrets: 'refuse',
        expectedUpdatedAt: 20,
      },
    );
    const fractional = await send(app, 'PUT', '/projects/p-1/agents/a-1', {
      ...input,
      expectedUpdatedAt: 1.5,
    });
    expect(fractional.status).toBe(400);
    expect(await fractional.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: {
        issues: [expect.objectContaining({ path: 'expectedUpdatedAt' })],
      },
    });
    const create = await send(app, 'POST', '/projects/p-1/agents', {
      ...input,
      expectedUpdatedAt: 20,
    });
    expect(create.status).toBe(400);
    expect(service.createProjectAgent).not.toHaveBeenCalled();
  });

  it('answers the domain’s stale refusal as 409 with the current stamp', async () => {
    service.updateProjectAgent.mockRejectedValue(
      new ProjectError(
        'PROJECT_AGENT_STALE',
        'The agent changed since it was read',
        409,
        { updatedAt: 20 },
      ),
    );
    const { app } = mount();
    const response = await send(app, 'PUT', '/projects/p-1/agents/a-1', {
      ...input,
      expectedUpdatedAt: 10,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'PROJECT_AGENT_STALE',
      data: { updatedAt: 20 },
    });
  });

  it('answers an unknown secret name as 400 naming it, never a pruned 201', async () => {
    service.createProjectAgent.mockRejectedValue(
      new ProjectError(
        'PROJECT_AGENT_SECRET_UNKNOWN',
        'Unknown secrets: NO_SUCH_SECRET',
        400,
        { secrets: ['NO_SUCH_SECRET'] },
      ),
    );
    const { app } = mount();
    const response = await send(app, 'POST', '/projects/p-1/agents', {
      ...input,
      secrets: ['NO_SUCH_SECRET'],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 'PROJECT_AGENT_SECRET_UNKNOWN',
      data: { secrets: ['NO_SUCH_SECRET'] },
    });
  });

  it('trims the name at the door and refuses one of only whitespace', async () => {
    const { app } = mount();
    const created = await send(app, 'POST', '/projects/p-1/agents', {
      ...input,
      name: '  Reviewer  ',
    });
    expect(created.status).toBe(201);
    expect(service.createProjectAgent.mock.calls[0]?.[2]).toMatchObject({
      name: 'Reviewer',
    });
    const blank = await send(app, 'POST', '/projects/p-1/agents', {
      ...input,
      name: '   ',
    });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [expect.objectContaining({ path: 'name' })] },
    });
  });
});
