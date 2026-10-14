// @vitest-environment jsdom
import type { ProjectDispatch } from '@tale/shared/schemas/project-dispatch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import {
  projectDispatchConfigurationQuery,
  projectDispatchKey,
  projectDispatchStatusQuery,
  requestDispatchPass,
  saveProjectDispatch,
  setDispatchGate,
} from './project-dispatch';
import { backendEntityPrefix } from './query-keys';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
}

/** The address a fetch call asked for, as it asked. */
function urlOf(input: RequestInfo | URL | undefined): string {
  if (input === undefined) return '';
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const HASH = 'a'.repeat(64);

const DISPATCH: ProjectDispatch = {
  enabled: true,
  agents: ['agent-scribe'],
  maxConcurrentRuns: 2,
  statuses: ['todo'],
  assignment: 'assigned',
};

function readback(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    unreadable: false,
    config: DISPATCH,
    hash: HASH,
    canEdit: true,
    state: null,
    pool: [],
    standingRoles: [],
    holds: [],
    gates: [],
    workers: { limit: 2, inUse: 0 },
    poolExceedsWorkers: false,
    passes: [],
    ...overrides,
  };
}

/** What the query's fetch answers, read as react-query would. */
async function run<T>(query: {
  queryFn?: unknown;
  queryKey: readonly unknown[];
}): Promise<T> {
  const queryFn = query.queryFn;
  if (typeof queryFn !== 'function') throw new Error('no queryFn');
  return (await queryFn({
    queryKey: query.queryKey,
    signal: new AbortController().signal,
    meta: undefined,
  })) as T;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a project dispatch over the app door', () => {
  it('reads what the dispatch does under the task entity, so task and project hints refresh it', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, readback()));
    const query = projectDispatchStatusQuery('org-1', 'proj/1');
    expect(query.queryKey.slice(0, 3)).toEqual(
      backendEntityPrefix('org-1', 'task'),
    );
    expect(query.queryKey).toEqual(projectDispatchKey('org-1', 'proj/1'));
    const status = await run<{ configured: boolean }>(query);
    expect(status.configured).toBe(true);
    expect(urlOf(fetch.mock.calls[0]?.[0])).toBe(
      '/api/app/tasks/dispatch/by-project/proj%2F1?orgId=org-1',
    );
  });

  it('refuses an answer in a shape this build does not read, instead of casting it', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, readback({ pool: 'everyone' })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      run(projectDispatchStatusQuery('org-1', 'proj-1')),
    ).rejects.toThrow(/does not read/);
  });

  it('reads the document the editor starts from without its project, and none as none', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(
        jsonResponse(200, {
          config: { ...DISPATCH, projectId: 'proj-1' },
          hash: HASH,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { config: null, hash: null }));
    const query = projectDispatchConfigurationQuery('org-1', 'proj-1');
    expect(query.queryKey.slice(0, 5)).toEqual(
      projectDispatchKey('org-1', 'proj-1'),
    );
    expect(await run(query)).toEqual({ dispatch: DISPATCH, hash: HASH });
    expect(await run(query)).toEqual({ dispatch: null, hash: null });
  });

  it('names a dispatch a newer version saved as the refusal it is', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(409, {
        error: 'CONFIG_UNREADABLE',
        message: 'The project’s stored dispatch cannot be read.',
      }),
    );
    const failure = await run(
      projectDispatchConfigurationQuery('org-1', 'proj-1'),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError<{ code: string }>).data.code).toBe(
      'CONFIG_UNREADABLE',
    );
  });

  it('saves the dispatch with its project over the version the editor read', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { ok: true, changed: true, hash: 'b'.repeat(64) }),
      );
    await expect(
      saveProjectDispatch('org-1', 'proj-1', {
        dispatch: DISPATCH,
        expectedHash: HASH,
      }),
    ).resolves.toEqual({ changed: true, hash: 'b'.repeat(64) });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe(
      '/api/app/tasks/dispatch/by-project/proj-1/configuration?orgId=org-1',
    );
    expect(init?.method).toBe('POST');
    expect(jsonBody(init)).toEqual({
      config: { ...DISPATCH, projectId: 'proj-1' },
      expectedHash: HASH,
    });
  });

  it('hands a refusal on with its code and the issues it names', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(400, {
        error: 'DISPATCH_INVALID',
        message: 'The dispatch names an agent this project cannot use.',
        data: {
          issues: [{ path: 'agents.0', message: 'No agent "agent-scribe".' }],
        },
      }),
    );
    const failure = await saveProjectDispatch('org-1', 'proj-1', {
      dispatch: DISPATCH,
      expectedHash: null,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError<Record<string, unknown>>).data).toMatchObject({
      code: 'DISPATCH_INVALID',
      issues: [{ path: 'agents.0', message: 'No agent "agent-scribe".' }],
    });
  });

  it('asks for a pass, and holds or opens a gate by its key', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, held: true, changed: true }),
      );
    await requestDispatchPass('org-1', 'proj-1');
    await expect(
      setDispatchGate('org-1', 'proj-1', { key: 'ci/main', state: 'hold' }),
    ).resolves.toEqual({ held: true, changed: true });
    expect(urlOf(fetch.mock.calls[0]?.[0])).toBe(
      '/api/app/tasks/dispatch/by-project/proj-1/pass?orgId=org-1',
    );
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
    const [gateUrl, gateInit] = fetch.mock.calls[1] ?? [];
    expect(urlOf(gateUrl)).toBe(
      '/api/app/tasks/dispatch/by-project/proj-1/gates/ci%2Fmain?orgId=org-1',
    );
    expect(jsonBody(gateInit)).toEqual({ state: 'hold' });
  });
});
