// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { onSessionLapsed } from '@/app/lib/auth/session-lapse';
import { LAPSED_SESSION_ANSWER } from '@/tests/utils/lapsed-session';

import {
  BackendApiError,
  backendApiErrorFromBody,
  backendFetch,
  backendUrl,
  eventsUrl,
  readBackendApiError,
} from './api-client';
import {
  isBackendReachable,
  PROBE_TIMEOUT_MS,
  probeBackend,
  reportBackendReachable,
  reportBackendUnreachable,
} from './connection-state';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
  reportBackendReachable();
});

describe('backendUrl', () => {
  it('prefixes /api/app and appends the org scope', () => {
    expect(backendUrl('/tasks', 'org1')).toBe('/api/app/tasks?orgId=org1');
  });

  it('appends with & when the route already carries a query', () => {
    expect(backendUrl('/tasks?limit=5', 'org1')).toBe(
      '/api/app/tasks?limit=5&orgId=org1',
    );
  });

  it('honors the deployment base path', () => {
    window.__ENV__ = { BASE_PATH: '/tale' };
    expect(backendUrl('/tasks', 'org1')).toBe('/tale/api/app/tasks?orgId=org1');
    expect(eventsUrl('org1')).toBe('/tale/events?orgId=org1');
  });

  it('url-encodes the org id', () => {
    expect(backendUrl('/tasks', 'a b')).toBe('/api/app/tasks?orgId=a%20b');
  });
});

describe('backendFetch', () => {
  it('GETs by default and returns the parsed body', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { threads: [] }));
    const result = await backendFetch<{ threads: unknown[] }>('/chat/threads', {
      orgId: 'org1',
    });
    expect(result).toEqual({ threads: [] });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/chat/threads?orgId=org1');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBeUndefined();
  });

  it('POSTs a JSON body when one is given', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(201, { id: 't1' }));
    const result = await backendFetch<{ id: string }>('/chat/threads', {
      orgId: 'org1',
      body: { title: 'Hello' },
    });
    expect(result).toEqual({ id: 't1' });
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ title: 'Hello' }));
    expect(new Headers(init?.headers as HeadersInit).get('content-type')).toBe(
      'application/json',
    );
  });

  it('maps a JSON error body onto BackendApiError', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(404, { error: 'thread not found' }),
    );
    const error = await backendFetch('/chat/threads/x', {
      orgId: 'org1',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackendApiError);
    if (error instanceof BackendApiError) {
      expect(error.status).toBe(404);
      expect(error.code).toBe('thread not found');
      expect(error.message).toBe('thread not found');
    }
  });

  it('prefers a message field over the error code for the message', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(503, {
        error: 'EMBEDDING_NOT_CONFIGURED',
        message: 'No embedding model is configured',
      }),
    );
    const error = await backendFetch('/knowledge/search', {
      orgId: 'org1',
      body: { query: 'x' },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackendApiError);
    if (error instanceof BackendApiError) {
      expect(error.code).toBe('EMBEDDING_NOT_CONFIGURED');
      expect(error.message).toBe('No embedding model is configured');
    }
  });

  // The flat envelope — the session 401, the URL guard, the API 404 — puts
  // the sentence in `error` and the code beside it. Read from `error`, the
  // client's code was the sentence, so no check on `UNAUTHORIZED` matched.
  it.each([
    [
      401,
      'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
      'UNAUTHORIZED',
    ],
    [400, 'The request URL contains a NUL character (U+0000)', 'INVALID_URL'],
    [404, 'Not found', 'NOT_FOUND'],
  ])(
    'reads a flat %i envelope: its code from `code`, its sentence as the message',
    async (status, sentence, code) => {
      vi.spyOn(window, 'fetch').mockResolvedValue(
        jsonResponse(status, { error: sentence, code }),
      );
      const error = await backendFetch('/tasks', { orgId: 'org1' }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(BackendApiError);
      expect(error).toMatchObject({ status, code, message: sentence });
    },
  );

  it('reads the code from `error` when the door answers { error: CODE }', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(403, { error: 'PROJECT_FORBIDDEN' }),
    );
    const error = await backendFetch('/projects/p1/secrets', {
      orgId: 'org1',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackendApiError);
    expect(error).toMatchObject({
      status: 403,
      code: 'PROJECT_FORBIDDEN',
      message: 'PROJECT_FORBIDDEN',
    });
  });

  it.each([null, 42, ''])(
    'falls back to `error` for the code when `code` is %j',
    async (code) => {
      vi.spyOn(window, 'fetch').mockResolvedValue(
        jsonResponse(403, { error: 'RBAC_FORBIDDEN', code }),
      );
      const error = await backendFetch('/tasks', { orgId: 'org1' }).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(BackendApiError);
      expect(error).toMatchObject({ code: 'RBAC_FORBIDDEN' });
    },
  );

  it('keeps the status text for a non-JSON error body', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response('Bad Gateway', { status: 502 }),
    );
    const error = await backendFetch('/tasks', { orgId: 'org1' }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(BackendApiError);
    if (error instanceof BackendApiError) {
      expect(error.status).toBe(502);
      expect(error.message).toBe('Request failed with status 502');
      expect(error.code).toBeUndefined();
    }
  });

  it('marks the backend reachable on any HTTP response, including 4xx', async () => {
    reportBackendUnreachable();
    expect(isBackendReachable()).toBe(false);
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(404, { error: 'missing' }),
    );
    await backendFetch('/tasks', { orgId: 'org1' }).catch(() => undefined);
    expect(isBackendReachable()).toBe(true);
  });

  it('marks the backend unreachable when fetch never gets a response', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    await expect(backendFetch('/tasks', { orgId: 'org1' })).rejects.toThrow(
      'Failed to fetch',
    );
    expect(isBackendReachable()).toBe(false);
  });

  it('rethrows a cancelled request without marking the backend unreachable', async () => {
    // TanStack Query aborts the signal of a read whose last observer
    // unmounted; the browser then rejects the fetch with the signal's reason.
    vi.spyOn(window, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason);
          });
        }),
    );
    const controller = new AbortController();
    const request = backendFetch('/chat/threads', {
      orgId: 'org1',
      signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(isBackendReachable()).toBe(true);
  });

  it('leaves an unreachable verdict standing when a request is cancelled', async () => {
    reportBackendUnreachable();
    vi.spyOn(window, 'fetch').mockRejectedValue(
      new DOMException('signal is aborted without reason', 'AbortError'),
    );
    await expect(
      backendFetch('/tasks', { orgId: 'org1' }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(isBackendReachable()).toBe(false);
  });

  it('returns undefined for a 204', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(
      backendFetch<undefined>('/tasks/t1', { orgId: 'org1', method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The raw-fetch lanes — the chat turn, the upload POSTs — read a refusal the
 * way `backendFetch` does. They used to throw `upload failed: <status>` and
 * keep nothing the door said.
 */
describe('readBackendApiError', () => {
  it("reads the door's code, message and data off a raw answer", async () => {
    const error = await readBackendApiError(
      jsonResponse(413, {
        error: 'FILE_SIZE_INVALID',
        message: 'The file exceeds the 512 MiB limit',
        data: { limitBytes: 536_870_912 },
      }),
    );
    expect(error).toBeInstanceOf(BackendApiError);
    expect(error).toMatchObject({
      status: 413,
      code: 'FILE_SIZE_INVALID',
      message: 'The file exceeds the 512 MiB limit',
      data: { limitBytes: 536_870_912 },
    });
  });

  // The raw lanes meet the flat envelope too (a lapsed session on an upload
  // POST or the chat turn): the code rides in `code`, the sentence in `error`.
  it("reads a flat envelope's code from `code` off a raw answer", async () => {
    const sentence =
      'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1';
    const error = await readBackendApiError(
      jsonResponse(401, { error: sentence, code: 'UNAUTHORIZED' }),
    );
    expect(error).toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
      message: sentence,
    });
  });

  it('keeps the status text, and says so, for a body that is not JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = await readBackendApiError(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    );
    expect(error).toMatchObject({
      status: 502,
      message: 'Request failed with status 502',
    });
    expect(error.code).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

/**
 * The one reading of both envelopes, called directly by the lane that parses
 * its body itself (the chat turn).
 */
describe('backendApiErrorFromBody', () => {
  it.each([
    [
      {
        error: 'The request URL contains a NUL character',
        code: 'INVALID_URL',
      },
      'INVALID_URL',
      'The request URL contains a NUL character',
    ],
    [{ error: 'PROJECT_FORBIDDEN' }, 'PROJECT_FORBIDDEN', 'PROJECT_FORBIDDEN'],
    [{ error: 'RBAC_FORBIDDEN', code: '' }, 'RBAC_FORBIDDEN', 'RBAC_FORBIDDEN'],
    [{ error: 'RBAC_FORBIDDEN', code: 42 }, 'RBAC_FORBIDDEN', 'RBAC_FORBIDDEN'],
  ])('reads %j as code %s', (body, code, message) => {
    expect(backendApiErrorFromBody(400, body)).toMatchObject({
      status: 400,
      code,
      message,
    });
  });
});

/**
 * Whichever lane meets the session door's 401 — `backendFetch`, a raw
 * answer an upload reads, the chat turn's own parse — tells the dashboard
 * the session has ended, so it can take the tab to sign-in. No other
 * refusal does.
 */
describe('the lapsed-session report', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
  });
  function listen(): ReturnType<typeof vi.fn> {
    const heard = vi.fn();
    stop = onSessionLapsed(heard);
    return heard;
  }

  it('is raised once by each lane that reads the session door', async () => {
    const heard = listen();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(LAPSED_SESSION_ANSWER.status, LAPSED_SESSION_ANSWER.body),
    );
    await expect(backendFetch('/users/me')).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(heard).toHaveBeenCalledTimes(1);

    await readBackendApiError(
      jsonResponse(LAPSED_SESSION_ANSWER.status, LAPSED_SESSION_ANSWER.body),
    );
    expect(heard).toHaveBeenCalledTimes(2);

    backendApiErrorFromBody(
      LAPSED_SESSION_ANSWER.status,
      LAPSED_SESSION_ANSWER.body,
    );
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('is not raised by any other refusal', async () => {
    const heard = listen();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse(403, { error: 'RBAC_FORBIDDEN' }),
    );
    await expect(backendFetch('/projects')).rejects.toBeInstanceOf(
      BackendApiError,
    );
    backendApiErrorFromBody(401, { error: 'bad key', code: 'INVALID_API_KEY' });
    backendApiErrorFromBody(403, { error: 'no', code: 'UNAUTHORIZED' });
    backendApiErrorFromBody(401, null);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('probeBackend', () => {
  it('asks /api/health past every cache, under the deployment base path', async () => {
    window.__ENV__ = { BASE_PATH: '/tale' };
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    await expect(probeBackend()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/tale/api/health',
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('marks the backend reachable on any HTTP status — a draining 503 still answers', async () => {
    reportBackendUnreachable();
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response('draining', { status: 503 }),
    );
    await expect(probeBackend()).resolves.toBe(true);
    expect(isBackendReachable()).toBe(true);
  });

  it('marks the backend unreachable when the probe gets no response', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(window, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    await expect(probeBackend()).resolves.toBe(false);
    expect(isBackendReachable()).toBe(false);
  });

  it('gives up on a probe that hangs past its timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(window, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const probe = probeBackend();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await expect(probe).resolves.toBe(false);
    expect(isBackendReachable()).toBe(false);
    vi.useRealTimers();
  });

  it('shares one in-flight probe between concurrent callers', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));
    await Promise.all([probeBackend(), probeBackend()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
