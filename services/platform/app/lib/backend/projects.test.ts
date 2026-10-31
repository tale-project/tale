// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { activeOrganizationId } from './adapters';
import {
  projectActionQueryAdapters,
  projectPaginatedAdapters,
  projectReadAdapters,
  projectWriteAdapters,
} from './projects';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The JSON a fetch call sent, parsed back (bodies are always strings here). */
function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
}

/** A full backend project row (nulls where the 0.4 doc has absent fields). */
function wireProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    organizationId: 'org-1',
    name: 'Apollo',
    description: null,
    icon: null,
    color: '#f00',
    key: 'APO',
    externalItemId: null,
    taskCounter: 3,
    openTaskCount: 2,
    doneTaskCount: 1,
    projectAgentCount: 0,
    teamId: null,
    sharedWithTeamIds: [],
    instructions: null,
    createdBy: 'u1',
    createdAt: 1000,
    updatedAt: 2000,
    archivedAt: null,
    pinnedAt: null,
    isOrgWide: true,
    canEdit: true,
    canAdminister: false,
    ...overrides,
  };
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('activeOrganizationId', () => {
  it('reads the org segment from a dashboard URL, base path stripped', () => {
    window.history.pushState({}, '', '/dashboard/org-77/projects');
    expect(activeOrganizationId()).toBe('org-77');

    window.__ENV__ = { BASE_PATH: '/tale' };
    window.history.pushState({}, '', '/tale/dashboard/org-9');
    expect(activeOrganizationId()).toBe('org-9');
  });

  it('answers undefined off the dashboard and on the switching screen', () => {
    window.history.pushState({}, '', '/log-in');
    expect(activeOrganizationId()).toBeUndefined();
    window.history.pushState({}, '', '/dashboard/switching');
    expect(activeOrganizationId()).toBeUndefined();
    window.history.pushState({}, '', '/dashboard');
    expect(activeOrganizationId()).toBeUndefined();
  });
});

describe('project read adapters', () => {
  it('lists projects under the project entity and strips nulls to the 0.4 shape', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { projects: [wireProject()] }));

    const row = projectReadAdapters['projects/queries:listProjects']?.(
      { organizationId: 'org-1' },
      {},
    );
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'project',
      'list',
      false,
    ]);

    const projects = (await row?.queryFn()) as Record<string, unknown>[];
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/projects?includeArchived=false&summary=true&orgId=org-1',
      expect.anything(),
    );
    const view = projects[0];
    expect(view?._id).toBe('p1');
    expect(view?._creationTime).toBe(1000);
    expect(view).not.toHaveProperty('description');
    expect(view).not.toHaveProperty('teamId');
    expect(view?.color).toBe('#f00');
    expect(view?.isOrgWide).toBe(true);
    expect(view?.canAdminister).toBe(false);
    expect(view).not.toHaveProperty('id');
  });

  it('answers null (skipped) when no org is in scope anywhere', () => {
    expect(
      projectReadAdapters['projects/queries:listProjects']?.({}, {}),
    ).toBeNull();
  });

  it('pages the overview newest first with required rollups, the asOf clock, limit and cursor', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          projects: [wireProject({ overdueTaskCount: 4 })],
          overdueTruncated: false,
          isDone: false,
          continueCursor: 'c-2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          projects: [wireProject({ id: 'p2', overdueTaskCount: 0 })],
          overdueTruncated: false,
          isDone: true,
          continueCursor: '',
        }),
      );

    expect(
      projectReadAdapters['projects/queries:listProjectsOverview'],
    ).toBeUndefined();
    const listing = projectPaginatedAdapters[
      'projects/queries:listProjectsOverview'
    ]?.({ organizationId: 'org-1', includeArchived: true, asOf: 5000 }, {});
    expect(listing?.queryKey).toEqual([
      'backend',
      'org-1',
      'project',
      'overview',
      'paginated',
      true,
      5000,
    ]);

    const first = await listing?.fetchPage(null, 50);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/overview?includeArchived=true&summary=true&asOf=5000&limit=50&orgId=org-1',
      expect.anything(),
    );
    expect(first?.isDone).toBe(false);
    expect(first?.continueCursor).toBe('c-2');
    expect(first?.page).toEqual([
      expect.objectContaining({
        _id: 'p1',
        _creationTime: 1000,
        overdueTaskCount: 4,
        openTaskCount: 2,
        doneTaskCount: 1,
        projectAgentCount: 0,
      }),
    ]);
    expect(first?.page[0]).not.toHaveProperty('id');
    expect(first?.page[0]).not.toHaveProperty('description');

    const second = await listing?.fetchPage('c-2', 50);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/overview?includeArchived=true&summary=true&asOf=5000&limit=50&cursor=c-2&orgId=org-1',
      expect.anything(),
    );
    expect(second).toEqual({
      page: [expect.objectContaining({ _id: 'p2', overdueTaskCount: 0 })],
      isDone: true,
      continueCursor: '',
    });
  });

  it('asks for at most one full page, and ends a page with no cursor to go on', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, { projects: [], isDone: false, continueCursor: '' }),
      )
      .mockResolvedValueOnce(
        // An older backend: every project, no page envelope.
        jsonResponse(200, { projects: [], overdueTruncated: false }),
      );
    const listing = projectPaginatedAdapters[
      'projects/queries:listProjectsOverview'
    ]?.({ organizationId: 'org-1' }, {});
    expect(listing?.queryKey).toEqual([
      'backend',
      'org-1',
      'project',
      'overview',
      'paginated',
      false,
      0,
    ]);

    await expect(listing?.fetchPage(null, 500)).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/overview?includeArchived=false&summary=true&limit=100&orgId=org-1',
      expect.anything(),
    );
    await expect(listing?.fetchPage('', 0)).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/overview?includeArchived=false&summary=true&limit=1&orgId=org-1',
      expect.anything(),
    );
  });

  it('answers no overview listing when no org is in scope anywhere', () => {
    expect(
      projectPaginatedAdapters['projects/queries:listProjectsOverview']?.(
        {},
        {},
      ),
    ).toBeNull();
  });

  it("reads one page of Home's navigator projects, with whether it holds them all", async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          projects: [wireProject({ pinnedAt: 3000 })],
          isDone: false,
        }),
      )
      .mockResolvedValueOnce(
        // An older backend: no flag, every project.
        jsonResponse(200, { projects: [wireProject()] }),
      );

    const row = projectReadAdapters['projects/queries:listSidebarProjects']?.(
      { organizationId: 'org-1', limit: 100 },
      {},
    );
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'project',
      'sidebar',
      100,
    ]);
    await expect(row?.queryFn()).resolves.toEqual({
      projects: [
        expect.objectContaining({ _id: 'p1', name: 'Apollo', pinnedAt: 3000 }),
      ],
      isDone: false,
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/sidebar?summary=true&limit=100&orgId=org-1',
      expect.anything(),
    );

    const unbounded = projectReadAdapters[
      'projects/queries:listSidebarProjects'
    ]?.({}, { organizationId: 'org-2' });
    expect(unbounded?.queryKey).toEqual([
      'backend',
      'org-2',
      'project',
      'sidebar',
      null,
    ]);
    await expect(unbounded?.queryFn()).resolves.toEqual({
      projects: [expect.objectContaining({ _id: 'p1' })],
      isDone: true,
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/app/projects/sidebar?summary=true&orgId=org-2',
      expect.anything(),
    );
  });

  it('keeps instructions in detail while metadata caches omit an older server response body', async () => {
    const instructions = 'Retained project instructions. '.repeat(600);
    const project = wireProject({
      instructions,
      description: 'Keep this card description',
      overdueTaskCount: 4,
    });
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation((url) =>
        Promise.resolve(
          jsonResponse(
            200,
            typeof url === 'string' && url.includes('/projects/p1?')
              ? { project }
              : { projects: [project], overdueTruncated: false },
          ),
        ),
      );
    for (const name of [
      'projects/queries:listProjects',
      'projects/queries:listSidebarProjects',
      'projects/queries:searchProjects',
      'projects/search:searchProjects',
    ]) {
      const adapter = projectReadAdapters[name]?.(
        { organizationId: 'org-1', query: 'Apollo' },
        {},
      );
      const result: unknown = await adapter?.queryFn();
      expect(result).not.toBeNull();
      expect(JSON.stringify(result)).not.toContain(instructions);
      expect(fetchSpy.mock.calls.at(-1)?.[0]).toContain('summary=true');
      if (name === 'projects/queries:listProjects')
        expect(result).toEqual([
          expect.objectContaining({ description: project.description }),
        ]);
    }
    const overview = await projectPaginatedAdapters[
      'projects/queries:listProjectsOverview'
    ]?.({ organizationId: 'org-1' }, {})?.fetchPage(null, 50);
    expect(overview?.page).toHaveLength(1);
    expect(JSON.stringify(overview)).not.toContain(instructions);
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toContain('summary=true');
    const detail = projectReadAdapters['projects/queries:getProject']?.(
      { organizationId: 'org-1', projectId: 'p1' },
      {},
    );
    await expect(detail?.queryFn()).resolves.toMatchObject({ instructions });
    expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe(
      '/api/app/projects/p1?orgId=org-1',
    );
  });

  it('maps a 404/403 project detail to null — the 0.4 not-found answer', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(404, { error: 'PROJECT_NOT_FOUND' }),
    );

    const row = projectReadAdapters['projects/queries:getProject']?.(
      { organizationId: 'org-1', projectId: 'p-gone' },
      {},
    );
    await expect(row?.queryFn()).resolves.toBeNull();
  });

  it('projects the palette search hit with the 0.4 snippet', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        projects: [wireProject({ description: 'Moon program' })],
      }),
    );

    const row = projectReadAdapters['projects/search:searchProjects']?.(
      { organizationId: 'org-1', query: 'apo' },
      {},
    );
    const hits = (await row?.queryFn()) as Record<string, unknown>[];
    expect(hits[0]).toMatchObject({
      projectId: 'p1',
      name: 'Apollo',
      key: 'APO',
      snippet: 'APO · Moon program',
      updatedAt: 2000,
    });
  });

  it('keys the project chats read under chat_thread so thread hints refresh it', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        mine: [
          {
            id: 't1',
            title: null,
            updatedAt: 1,
            sharedWithProject: null,
            userId: 'u1',
            authorName: null,
          },
        ],
        shared: [],
      }),
    );

    const row = projectReadAdapters[
      'chat/project_threads:listThreadsForProject'
    ]?.({ organizationId: 'org-1', projectId: 'p1' }, {});
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'chat_thread',
      'project-threads',
      'p1',
    ]);
    const result = (await row?.queryFn()) as {
      mine: Record<string, unknown>[];
    };
    expect(result.mine[0]).not.toHaveProperty('title');
    expect(result.mine[0]).not.toHaveProperty('sharedWithProject');
    expect(result.mine[0]?.authorName).toBeNull();
  });

  it('lists project secrets as metadata with nulls stripped', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        secrets: [
          {
            name: 'API_TOKEN',
            description: null,
            updatedAt: 5,
            updatedBy: 'u1',
          },
        ],
      }),
    );

    const row = projectReadAdapters[
      'projects/secrets/queries:listProjectSecrets'
    ]?.({ projectId: 'p1' }, { organizationId: 'org-route' });
    expect(row?.queryKey).toEqual([
      'backend',
      'org-route',
      'project',
      'project-secrets',
      'p1',
    ]);
    const secrets = (await row?.queryFn()) as Record<string, unknown>[];
    expect(secrets[0]).toEqual({
      name: 'API_TOKEN',
      updatedAt: 5,
      updatedBy: 'u1',
    });
  });

  it('serves the serving previews from their lane routes', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { ok: false, reason: 'nothing' })),
      );

    const workflow = projectActionQueryAdapters[
      'automations/serving_preview:previewUnpinnedAgentServing'
    ]?.({ organizationId: 'org-1', model: 'm/x', harness: 'claude-code' }, {});
    await workflow?.();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/automations/serving-preview?model=m%2Fx&harness=claude-code&orgId=org-1',
      expect.anything(),
    );

    const task = projectActionQueryAdapters[
      'tasks/serving_preview:previewUnpinnedTaskServing'
    ]?.({ organizationId: 'org-1', model: 'm/x', harness: 'claude-code' }, {});
    await task?.();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/tasks/serving-preview?model=m%2Fx&harness=claude-code&orgId=org-1',
      expect.anything(),
    );
  });

  it('serves the composer walks from their org-scoped routes', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { models: [] })),
      );

    const models = projectActionQueryAdapters[
      'chat/composer:listComposerModels'
    ]?.({ organizationId: 'org-1' }, {});
    await models?.();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/chat/composer/models?orgId=org-1',
      expect.anything(),
    );

    const capabilities = projectActionQueryAdapters[
      'chat/composer:listProjectCapabilities'
    ]?.({ organizationId: 'org-1', projectId: 'p1' }, {});
    await capabilities?.();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/chat/composer/project/p1/capabilities?orgId=org-1',
      expect.anything(),
    );
  });
});

describe('project write adapters', () => {
  it('sends the agent read stamp and refreshes only for a stale refusal', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const adapter =
      projectWriteAdapters['projects/mutations:updateProjectAgent'];
    await adapter?.run(
      { agentId: 'a1', name: 'Draft', expectedUpdatedAt: 20 },
      { organizationId: 'org-1' },
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/projects/agents/a1?orgId=org-1');
    expect(jsonBody(init)).toEqual({ name: 'Draft', expectedUpdatedAt: 20 });
    expect(
      adapter?.refusalInvalidates?.(
        new AppError({ code: 'PROJECT_AGENT_STALE' }),
      ),
    ).toBe(true);
    expect(
      adapter?.refusalInvalidates?.(new AppError({ code: 'RBAC_FORBIDDEN' })),
    ).toBe(false);
    expect(
      adapter?.refusalInvalidates?.(new TypeError('Network failure')),
    ).toBe(false);
  });
  it('creates a project and answers the new id like the 0.4 mutation', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { projectId: 'p-new' }));

    const adapter = projectWriteAdapters['projects/mutations:createProject'];
    await expect(
      adapter?.run({ organizationId: 'org-1', name: 'Apollo' }, {}),
    ).resolves.toBe('p-new');
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/projects?orgId=org-1');
    expect(jsonBody(init)).toEqual({ name: 'Apollo' });
  });

  it('POSTs an update verb with the route org when args carry none', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));

    const adapter =
      projectWriteAdapters['projects/mutations:updateProjectIdentity'];
    await adapter?.run(
      { projectId: 'p1', name: 'Artemis' },
      { organizationId: 'org-route' },
    );
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/projects/p1/identity?orgId=org-route');
    expect(jsonBody(init)).toEqual({ name: 'Artemis' });
  });

  it('refuses a write with no organization in scope', async () => {
    const adapter = projectWriteAdapters['projects/mutations:archiveProject'];
    await expect(adapter?.run({ projectId: 'p1' }, {})).rejects.toThrow(
      'No active organization',
    );
  });

  it('deletes a project with the mode body and returns the walk counts', async () => {
    const counts = {
      detachedDocCount: 1,
      detachedThreadCount: 2,
      cascadedDocCount: 0,
      cascadedThreadCount: 0,
    };
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, counts));

    const adapter = projectWriteAdapters['projects/mutations:deleteProject'];
    await expect(
      adapter?.run(
        { projectId: 'p1', mode: 'detach' },
        { organizationId: 'org-1' },
      ),
    ).resolves.toEqual(counts);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/projects/p1?orgId=org-1');
    expect(init?.method).toBe('DELETE');
  });

  it('writes project secrets on their routes (set, pair, delete)', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { ok: true })),
      );

    await projectWriteAdapters[
      'projects/secrets/actions:setProjectSecret'
    ]?.run(
      {
        organizationId: 'org-1',
        projectId: 'p1',
        name: 'API_TOKEN',
        value: 'tok-123',
      },
      {},
    );
    let [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/projects/p1/secrets?orgId=org-1');
    expect(jsonBody(init)).toEqual({ name: 'API_TOKEN', value: 'tok-123' });

    await projectWriteAdapters[
      'projects/secrets/actions:setProjectSecretPair'
    ]?.run(
      {
        organizationId: 'org-1',
        projectId: 'p1',
        baseName: 'PORTAL',
        username: 'alice',
        password: 'hunter2-long',
      },
      {},
    );
    [url, init] = fetchSpy.mock.calls[1] ?? [];
    expect(url).toBe('/api/app/projects/p1/secrets/pair?orgId=org-1');
    expect(jsonBody(init)).toEqual({
      baseName: 'PORTAL',
      username: 'alice',
      password: 'hunter2-long',
    });

    await projectWriteAdapters[
      'projects/secrets/actions:deleteProjectSecret'
    ]?.run({ organizationId: 'org-1', projectId: 'p1', name: 'API_TOKEN' }, {});
    [url, init] = fetchSpy.mock.calls[2] ?? [];
    expect(url).toBe('/api/app/projects/p1/secrets/API_TOKEN?orgId=org-1');
    expect(init?.method).toBe('DELETE');
  });

  it('upserts and deletes org agent secrets on their routes', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { created: true })),
      );

    await projectWriteAdapters['agent_secrets/actions:upsertAgentSecret']?.run(
      { organizationId: 'org-1', name: 'API_KEY', value: 's3cret' },
      {},
    );
    let [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/agent-secrets?orgId=org-1');
    expect(jsonBody(init)).toEqual({ name: 'API_KEY', value: 's3cret' });

    await projectWriteAdapters[
      'agent_secrets/mutations:deleteAgentSecret'
    ]?.run({ organizationId: 'org-1', name: 'API_KEY' }, {});
    [url, init] = fetchSpy.mock.calls[1] ?? [];
    expect(url).toBe('/api/app/agent-secrets/API_KEY?orgId=org-1');
    expect(init?.method).toBe('DELETE');
  });
});
