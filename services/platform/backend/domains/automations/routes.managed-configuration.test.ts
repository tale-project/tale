// @vitest-environment node
import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const io = vi.hoisted(() => ({
  role: 'admin',
  read: vi.fn(),
  write: vi.fn(),
  project: vi.fn(),
  writable: vi.fn(),
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
vi.mock('../projects/service.ts', async (original) => ({
  ...(await original<typeof import('../projects/service.ts')>()),
  getProjectAuthContext: async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: io.role,
    teamIds: [],
  }),
  assertWritable: io.writable,
}));
vi.mock('./project-visibility.ts', async (original) => ({
  ...(await original<typeof import('./project-visibility.ts')>()),
  readableProject: io.project,
}));
vi.mock('./managed-configuration.ts', async (original) => ({
  ...(await original<typeof import('./managed-configuration.ts')>()),
  readManagedAutomation: io.read,
  writeManagedAutomation: io.write,
}));

import { ProjectError } from '../projects/service.ts';
import { createAutomationRoutes } from './routes.ts';
import { AutomationError } from './store.ts';

const config = {
  projectId: 'p1',
  name: 'example/review',
  document: { name: 'example/review' },
  settings: null,
  presentation: null,
  taskContract: null,
};
const body = {
  resource: { kind: 'automation-definition', config },
  expectedHash: null,
};
function request(method: 'GET' | 'POST', value: unknown = body, suffix = '') {
  return new Hono()
    .route(
      '/api/app/automations',
      createAutomationRoutes({
        sql: {} as never,
        auth: {} as never,
      }),
    )
    .request(
      `/api/app/automations/example%2Freview/configuration?projectId=p1&kind=automation-definition${suffix}`,
      {
        method,
        ...(method === 'POST'
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(value),
            }
          : {}),
      },
    );
}
beforeEach(() => {
  vi.resetAllMocks();
  io.role = 'admin';
  io.project.mockResolvedValue({ id: 'p1', archivedAt: null });
  io.read.mockResolvedValue({ config: null, hash: null });
  io.write.mockResolvedValue({ name: 'example/review', version: 1 });
});

describe('managed automation configuration door', () => {
  it.each(['GET', 'POST'] as const)(
    'requires author and writable project permissions on %s',
    async (method) => {
      io.role = 'member';
      expect((await request(method)).status).toBe(403);
      expect(io.read).not.toHaveBeenCalled();
      expect(io.write).not.toHaveBeenCalled();
      io.role = 'developer';
      io.writable.mockImplementation(() => {
        throw new ProjectError(
          'PROJECT_FORBIDDEN',
          'Project is read-only.',
          403,
        );
      });
      const response = await request(method);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'PROJECT_FORBIDDEN',
        message: 'Project is read-only.',
      });
      expect(io.read).not.toHaveBeenCalled();
      expect(io.write).not.toHaveBeenCalled();
    },
  );
  it.each([null, { id: 'p1', archivedAt: 1 }])(
    'does not reveal or mutate a missing/archived project',
    async (project) => {
      io.project.mockResolvedValue(project);
      expect((await request('GET')).status).toBe(404);
      expect((await request('POST')).status).toBe(404);
      expect(io.read).not.toHaveBeenCalled();
      expect(io.write).not.toHaveBeenCalled();
    },
  );
  it('validates identity, complete metadata and reviewed preimage before reading native state', async () => {
    for (const invalid of [
      { resource: body.resource },
      { ...body, expectedHash: 'bad' },
      { ...body, unexpected: true },
      {
        ...body,
        resource: {
          ...body.resource,
          config: { ...config, name: 'another/name' },
        },
      },
      {
        ...body,
        resource: {
          ...body.resource,
          config: { ...config, settings: undefined },
        },
      },
    ])
      expect((await request('POST', invalid)).status).toBe(400);
    expect(io.read).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  });
  it('names slash-separated workflows losslessly and scopes native read and write', async () => {
    expect((await request('GET')).status).toBe(200);
    expect(io.read).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'o1', projectId: 'p1', name: 'example/review' },
      'automation-definition',
    );
    expect((await request('POST')).status).toBe(200);
    expect(io.write).toHaveBeenCalledWith(expect.anything(), 'o1', 'u1', body);
  });
  it('does not run authoring tests after a failed ownership/tombstone read, and preserves native stale codes', async () => {
    io.read.mockRejectedValueOnce(
      new AutomationError('AUTOMATION_DELETED', 'Deleted.', 409),
    );
    expect((await request('POST')).status).toBe(409);
    expect(io.write).not.toHaveBeenCalled();
    io.write.mockRejectedValueOnce(
      new AutomationError('AUTOMATION_VERSION_STALE', 'Changed.', 409),
    );
    const stale = await request('POST');
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({
      error: 'AUTOMATION_VERSION_STALE',
      message: 'Changed.',
    });
  });
});
