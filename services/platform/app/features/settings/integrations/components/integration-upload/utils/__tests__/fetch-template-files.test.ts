import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IntegrationTemplate } from '../../constants/integration-templates';

import {
  fetchTemplateFiles,
  clearTemplateCache,
} from '../fetch-template-files';

const restTemplate: IntegrationTemplate = {
  name: 'github',
  title: 'GitHub',
  description: 'GitHub REST API integration',
  authMethod: 'bearer_token',
  type: 'rest_api',
};

const sqlTemplate: IntegrationTemplate = {
  name: 'protel',
  title: 'Protel PMS',
  description: 'Hotel PMS SQL integration',
  authMethod: 'basic_auth',
  type: 'sql',
};

const validConfig = JSON.stringify({
  name: 'github',
  title: 'GitHub',
  authMethod: 'bearer_token',
  secretBindings: ['accessToken'],
  operations: [{ name: 'list_repos', title: 'List repositories' }],
});

const validConnector = `
const connector = {
  operations: ['list_repos'],
  testConnection: function(ctx) { return { status: 'ok' }; },
  execute: function(ctx) { return ctx; }
};
`;

const sqlConfig = JSON.stringify({
  name: 'protel',
  title: 'Protel PMS',
  type: 'sql',
  authMethod: 'basic_auth',
  secretBindings: ['username', 'password'],
  operations: [
    {
      name: 'list_reservations',
      title: 'List reservations',
      query: 'SELECT 1',
    },
  ],
  sqlConnectionConfig: { engine: 'mssql', port: 1433 },
});

function mockResponse(body: string | Blob, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    blob: () =>
      Promise.resolve(
        body instanceof Blob ? body : new Blob([body], { type: 'text/plain' }),
      ),
  } as Response);
}

function toUrlString(input: string | URL | Request) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function mockFetchForRest() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const urlStr = toUrlString(url);
    if (urlStr.includes('config.json')) return mockResponse(validConfig);
    if (urlStr.includes('connector.ts')) return mockResponse(validConnector);
    if (urlStr.includes('icon.svg'))
      return mockResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    return mockResponse('', false);
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  clearTemplateCache();
});

describe('fetchTemplateFiles', () => {
  it('fetches all files for a REST template and parses successfully', async () => {
    const fetchSpy = mockFetchForRest();

    const result = await fetchTemplateFiles(restTemplate);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.config.name).toBe('github');
    expect(result.data?.connectorCode).toBeTruthy();
    expect(result.data?.iconFile).toBeDefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('returns cached result on subsequent calls', async () => {
    const fetchSpy = mockFetchForRest();

    const first = await fetchTemplateFiles(restTemplate);
    expect(first.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const second = await fetchTemplateFiles(restTemplate);
    expect(second.success).toBe(true);
    expect(second).toBe(first);
    // No additional fetch calls
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not cache failed results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = toUrlString(url);
      if (urlStr.includes('config.json')) return mockResponse('', false);
      if (urlStr.includes('connector.ts')) return mockResponse(validConnector);
      if (urlStr.includes('icon.svg'))
        return mockResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      return mockResponse('', false);
    });

    const first = await fetchTemplateFiles(restTemplate);
    expect(first.success).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Second call should re-fetch, not return cached error
    await fetchTemplateFiles(restTemplate);
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it('returns error when config.json fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = toUrlString(url);
      if (urlStr.includes('config.json')) return mockResponse('', false);
      if (urlStr.includes('connector.ts')) return mockResponse(validConnector);
      if (urlStr.includes('icon.svg'))
        return mockResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      return mockResponse('', false);
    });

    const result = await fetchTemplateFiles(restTemplate);
    expect(result.success).toBe(false);
    expect(result.error).toContain('configuration');
  });

  it('returns error when connector.ts fetch fails for REST template', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = toUrlString(url);
      if (urlStr.includes('config.json')) return mockResponse(validConfig);
      if (urlStr.includes('connector.ts')) return mockResponse('', false);
      if (urlStr.includes('icon.svg'))
        return mockResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      return mockResponse('', false);
    });

    const result = await fetchTemplateFiles(restTemplate);
    expect(result.success).toBe(false);
    expect(result.error).toContain('connector');
  });

  it('skips connector fetch for SQL template', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = toUrlString(url);
      if (urlStr.includes('config.json')) return mockResponse(sqlConfig);
      if (urlStr.includes('icon.svg'))
        return mockResponse(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      return mockResponse('', false);
    });

    const result = await fetchTemplateFiles(sqlTemplate);

    expect(result.success).toBe(true);
    expect(result.data?.config.name).toBe('protel');
    const fetchedUrls = fetchSpy.mock.calls.map((call) => toUrlString(call[0]));
    expect(fetchedUrls.some((u) => u.includes('connector.ts'))).toBe(false);
  });

  it('succeeds without icon when icon fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlStr = toUrlString(url);
      if (urlStr.includes('config.json')) return mockResponse(validConfig);
      if (urlStr.includes('connector.ts')) return mockResponse(validConnector);
      if (urlStr.includes('icon.svg')) return mockResponse('', false);
      return mockResponse('', false);
    });

    const result = await fetchTemplateFiles(restTemplate);
    expect(result.success).toBe(true);
    expect(result.data?.iconFile).toBeUndefined();
  });

  it('handles network errors gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const result = await fetchTemplateFiles(restTemplate);
    expect(result.success).toBe(false);
    expect(result.error).toContain('configuration');
  });
});
