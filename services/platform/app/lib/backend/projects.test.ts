// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activeOrganizationId } from './convex-adapters';
import {
  projectActionQueryAdapters,
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
    knowledgeMode: null,
    agentMode: null,
    recommendedAgentSlugs: [],
    allowedAgentSlugs: [],
    modelMode: null,
    recommendedModels: [],
    allowedModels: [],
    connectorsMode: null,
    allowedConnectorSlugs: [],
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
      '/api/app/projects?includeArchived=false&orgId=org-1',
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

  it('builds the overview with required rollups and the asOf clock', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        projects: [wireProject({ overdueTaskCount: 4 })],
        overdueTruncated: false,
      }),
    );

    const row = projectReadAdapters['projects/queries:listProjectsOverview']?.(
      { organizationId: 'org-1', includeArchived: true, asOf: 5000 },
      {},
    );
    expect(row?.queryKey).toEqual([
      'backend',
      'org-1',
      'project',
      'overview',
      true,
      5000,
    ]);
    const result = (await row?.queryFn()) as {
      projects: Record<string, unknown>[];
      overdueTruncated: boolean;
    };
    expect(window.fetch).toHaveBeenCalledWith(
      '/api/app/projects/overview?includeArchived=true&asOf=5000&orgId=org-1',
      expect.anything(),
    );
    expect(result.projects[0]?.overdueTaskCount).toBe(4);
    expect(result.projects[0]?.openTaskCount).toBe(2);
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

  it('moves a thread through the chat verb and invalidates both families', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true }),
    );

    const adapter =
      projectWriteAdapters['projects/mutations:moveThreadToProject'];
    await adapter?.run(
      { threadId: 't1', projectId: 'p1' },
      { organizationId: 'org-1' },
    );
    expect(window.fetch).toHaveBeenCalledWith(
      '/api/app/chat/threads/t1/project?orgId=org-1',
      expect.objectContaining({ method: 'POST' }),
    );

    const invalidateQueries = vi.fn();
    adapter?.invalidate?.(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only invalidateQueries is exercised
      { invalidateQueries } as never,
      { threadId: 't1', projectId: 'p1' },
      { organizationId: 'org-1' },
    );
    const keys = invalidateQueries.mock.calls.map(
      (call) => (call[0] as { queryKey: unknown }).queryKey,
    );
    expect(keys).toContainEqual(['backend', 'org-1', 'chat_thread']);
    expect(keys).toContainEqual(['backend', 'org-1', 'project']);
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
