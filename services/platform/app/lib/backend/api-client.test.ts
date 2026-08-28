// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BackendApiError,
  backendFetch,
  backendUrl,
  eventsUrl,
} from './api-client';

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

  it('returns undefined for a 204', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await expect(
      backendFetch<undefined>('/tasks/t1', { orgId: 'org1', method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});
