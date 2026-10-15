// @vitest-environment node

/**
 * The template catalog's app door: authors list it, preview one template
 * and create from one — the engine checks the document and runs its tests
 * as any save does, and only then is everything written, in one go.
 */

import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const io = vi.hoisted(() => ({
  role: 'developer',
  prepare: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  commit: vi.fn(),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (original) => ({
  ...(await original<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: io.role } as never);
      await next();
    },
}));
vi.mock('../../core/connector_credentials/connector_catalog.ts', () => ({
  loadConnectorDefinitions: () => [],
}));
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: () => Promise.resolve({}),
}));
vi.mock('./project-visibility.ts', async (original) => ({
  ...(await original<typeof import('./project-visibility.ts')>()),
  readableProjectIds: () => Promise.resolve(['prj_1']),
}));
vi.mock('./templates.ts', () => ({
  listTemplateCards: io.list,
  readTemplateDetail: io.detail,
  prepareTemplateInstance: io.prepare,
  commitTemplateInstance: io.commit,
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({ get: () => Promise.resolve(null) }),
}));

import { createAutomationTemplateRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

/** A template's document as prepared: one step, and a test that passes. */
const DOCUMENT = {
  version: 1,
  name: 'tell-ada',
  nodes: [
    {
      id: 'double',
      type: 'transform',
      input: { n: '{{ input.n }}' },
      code: 'return input.n * 2;',
    },
  ],
  output: '{{ nodes.double.output }}',
  tests: [{ name: 'doubles seven', input: { n: 7 }, expect: { output: 14 } }],
};

const PREPARED = {
  document: DOCUMENT,
  message: 'Created from the template "Tell the reviewer".',
  presentation: { name: 'Tell Ada', icon: 'bell-ring' },
  projectId: 'prj_1',
  trigger: { kind: 'event', event: 'task.status_changed', enabled: false },
};

function app() {
  return new Hono().route(
    '/api/app/automation-templates',
    createAutomationTemplateRoutes({ sql: {} as never, auth: {} as never }),
  );
}

const create = (body: unknown, slug = 'notify-reviewer') =>
  app().request(`/api/app/automation-templates/${slug}/instantiate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const BODY = {
  name: 'tell-ada',
  displayName: 'Tell Ada',
  answers: { project: 'prj_1', reviewer: 'usr_ada' },
  locale: 'de',
};

beforeEach(() => {
  vi.clearAllMocks();
  io.role = 'developer';
  io.list.mockResolvedValue([{ slug: 'notify-reviewer' }]);
  io.detail.mockResolvedValue({ slug: 'gmail/sync-emails' });
  io.prepare.mockResolvedValue(PREPARED);
  io.commit.mockResolvedValue({
    name: 'tell-ada',
    version: 1,
    deployed: false,
    trigger: { token: 'whk_once', enabled: false },
  });
});

describe('the template catalog, at the app door', () => {
  it('lists it for an author', async () => {
    const response = await app().request('/api/app/automation-templates');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      templates: [{ slug: 'notify-reviewer' }],
    });
  });

  it('lists nothing to a member, who cannot create automations', async () => {
    io.role = 'member';
    const response = await app().request('/api/app/automation-templates');
    expect(response.status).toBe(403);
    expect(io.list).not.toHaveBeenCalled();
  });

  it('previews a template whose slug is a path', async () => {
    const response = await app().request(
      '/api/app/automation-templates/gmail/sync-emails',
    );
    expect(response.status).toBe(200);
    expect(io.detail).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'gmail/sync-emails',
      // What is in use counts only what the reader can see.
      ['prj_1'],
    );
  });

  it('answers a template it does not hold with 404', async () => {
    io.detail.mockRejectedValue(
      new AutomationError('TEMPLATE_NOT_FOUND', 'There is none.', 404),
    );
    const response = await app().request(
      '/api/app/automation-templates/nothing-here',
    );
    expect(response.status).toBe(404);
  });

  it('checks the document and runs its tests, then writes it whole [AUTO-R61]', async () => {
    const response = await create(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: 'tell-ada',
      version: 1,
      deployed: false,
      testsPassed: true,
      // A webhook's address, minted by this create, is shown once.
      trigger: { token: 'whk_once' },
    });
    expect(io.prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'o1',
        slug: 'notify-reviewer',
        name: 'tell-ada',
        displayName: 'Tell Ada',
        answers: BODY.answers,
        locale: 'de',
        visibleProjectIds: ['prj_1'],
      }),
    );
    expect(io.commit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'o1',
        name: 'tell-ada',
        origin: { actor: 'u1', via: 'app' },
        prepared: PREPARED,
        // The engine's save ran the template's tests.
        checked: expect.objectContaining({
          message: PREPARED.message,
          testsPassed: true,
        }),
        start: false,
      }),
    );
  });

  it('starts it when the create asks, in the creator’s time zone', async () => {
    const response = await create(
      { ...BODY, start: true, timezone: 'Europe/Zurich' },
      'gmail/sync-emails',
    );
    expect(response.status).toBe(201);
    expect(io.prepare).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slug: 'gmail/sync-emails',
        timezone: 'Europe/Zurich',
      }),
    );
    expect(io.commit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ start: true }),
    );
  });

  it('starts the create a tab of the previous release asks to start with enableTrigger', async () => {
    const response = await create({ ...BODY, enableTrigger: true });
    expect(response.status).toBe(201);
    expect(io.commit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ start: true }),
    );
  });

  it('counts what is in use for the reader on the list too', async () => {
    await app().request('/api/app/automation-templates');
    expect(io.list).toHaveBeenCalledWith(expect.anything(), 'o1', ['prj_1']);
  });

  it('writes nothing for a document its checks refuse [AUTO-R61]', async () => {
    io.prepare.mockResolvedValue({
      ...PREPARED,
      document: {
        ...DOCUMENT,
        nodes: [{ id: 'mystery', type: 'nowhere.nothing', input: {} }],
        output: '{{ nodes.mystery.output }}',
        tests: [],
      },
    });
    const response = await create({ ...BODY, start: true });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(io.commit).not.toHaveBeenCalled();
  });

  it('refuses a member, writing nothing', async () => {
    io.role = 'member';
    const response = await create(BODY);
    expect(response.status).toBe(403);
    expect(io.prepare).not.toHaveBeenCalled();
    expect(io.commit).not.toHaveBeenCalled();
  });

  it('names each answer it cannot use, writing nothing', async () => {
    io.prepare.mockRejectedValue(
      new AutomationError(
        'TEMPLATE_ANSWERS_INVALID',
        'Some answers cannot be used.',
        400,
        { fields: [{ field: 'reviewer', code: 'unknown', message: 'x' }] },
      ),
    );
    const response = await create(BODY);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'TEMPLATE_ANSWERS_INVALID',
      data: { fields: [{ field: 'reviewer', code: 'unknown' }] },
    });
    expect(io.commit).not.toHaveBeenCalled();
  });

  it('refuses a name another automation has', async () => {
    io.commit.mockRejectedValue(
      new AutomationError(
        'AUTOMATION_NAME_TAKEN',
        'An automation with this name already exists.',
        409,
      ),
    );
    const response = await create(BODY);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'AUTOMATION_NAME_TAKEN',
    });
  });

  it('refuses a body that is not a create', async () => {
    for (const body of [
      { name: 'tell-ada', answers: 'all' },
      { ...BODY, timezone: 'Mars/Olympus' },
      { ...BODY, start: 'yes' },
    ]) {
      const response = await create(body);
      expect(response.status).toBe(400);
    }
    expect(io.prepare).not.toHaveBeenCalled();
  });
});
