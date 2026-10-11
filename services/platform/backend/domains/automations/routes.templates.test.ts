// @vitest-environment node

/**
 * The starters' app door: authors list them and create from one — the
 * first version through the editor's save, its tests run, created and
 * never appended to, installed in the answered project, the trigger set
 * off.
 */

import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const io = vi.hoisted(() => ({
  role: 'developer',
  prepare: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  setTrigger: vi.fn(),
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
  prepareTemplateInstance: io.prepare,
}));
vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  saveVersion: io.save,
  setTrigger: io.setTrigger,
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({ get: () => Promise.resolve(null) }),
}));

import { createAutomationTemplateRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

/** A starter's document as prepared: one step, and a test that passes. */
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
  message: 'Created from the starter "Tell the reviewer".',
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

const create = (body: unknown) =>
  app().request('/api/app/automation-templates/notify-reviewer/instantiate', {
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
  io.prepare.mockResolvedValue(PREPARED);
  io.save.mockResolvedValue({ name: 'tell-ada', version: 1 });
  io.setTrigger.mockResolvedValue({ token: 'whk_once' });
});

describe('the starters, at the app door', () => {
  it('lists them for an author', async () => {
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

  it('creates version 1 through the editor’s save, installs it and sets its trigger off [AUTO-R44]', async () => {
    const response = await create(BODY);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: 'tell-ada',
      version: 1,
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
    expect(io.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'o1',
        name: 'tell-ada',
        actor: 'u1',
        create: true,
        projectId: 'prj_1',
        origin: { via: 'app' },
        presentation: PREPARED.presentation,
        message: PREPARED.message,
        // The save ran the starter's tests.
        testsPassed: true,
      }),
    );
    expect(io.setTrigger).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'o1',
      name: 'tell-ada',
      trigger: PREPARED.trigger,
      actor: 'u1',
    });
  });

  it('sets the trigger on when the create asks', async () => {
    const response = await create({ ...BODY, enableTrigger: true });
    expect(response.status).toBe(201);
    expect(io.setTrigger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: { ...PREPARED.trigger, enabled: true },
      }),
    );
  });

  it('refuses a member, writing nothing', async () => {
    io.role = 'member';
    const response = await create(BODY);
    expect(response.status).toBe(403);
    expect(io.prepare).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
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
    expect(io.save).not.toHaveBeenCalled();
    expect(io.setTrigger).not.toHaveBeenCalled();
  });

  it('refuses a name another automation has, and sets no trigger', async () => {
    io.save.mockRejectedValue(
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
    expect(io.setTrigger).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a create', async () => {
    const response = await create({ name: 'tell-ada', answers: 'all' });
    expect(response.status).toBe(400);
    expect(io.prepare).not.toHaveBeenCalled();
  });
});
