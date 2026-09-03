// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsWriteAdapters } from './settings';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
}

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

/**
 * The update row must forward everything the edit and replace dialogs can
 * submit — a field the adapter drops is an edit that reads as saved while
 * the backend received an empty patch.
 */
describe('provider_credentials/actions:updateCredential', () => {
  const adapter =
    settingsWriteAdapters['provider_credentials/actions:updateCredential'];

  it('forwards the broker Replace-configuration document as the rotated secret', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const broker = {
      endpoint: 'https://broker.example/tokens',
      httpMethod: 'GET',
      auth: { method: 'none' },
    };
    await adapter?.run(
      { credentialId: 'cred-1', broker },
      { organizationId: 'org1' },
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/provider-credentials/cred-1?orgId=org1');
    expect(jsonBody(init)).toEqual({ secret: JSON.stringify(broker) });
  });

  it("forwards the edit dialog's endpointUrl and name", async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    await adapter?.run(
      {
        credentialId: 'cred-2',
        name: 'Azure prod',
        endpointUrl: 'https://prod.openai.azure.com/openai/v1',
      },
      { organizationId: 'org1' },
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(jsonBody(init)).toEqual({
      name: 'Azure prod',
      endpointUrl: 'https://prod.openai.azure.com/openai/v1',
    });
  });

  it("forwards the env Replace dialog's envName and an isDefault flip", async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    await adapter?.run(
      {
        credentialId: 'cred-3',
        envName: 'TALE_PROVIDER_KEY_OPENAI_2',
        isDefault: true,
      },
      { organizationId: 'org1' },
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(jsonBody(init)).toEqual({
      envName: 'TALE_PROVIDER_KEY_OPENAI_2',
      isDefault: true,
    });
  });

  it('still forwards the plain fields (status, allowlist, secret) unchanged', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    await adapter?.run(
      {
        credentialId: 'cred-4',
        status: 'disabled',
        modelAllowlist: ['gpt-5.5'],
        secret: 'sk-rotated',
      },
      { organizationId: 'org1' },
    );
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(jsonBody(init)).toEqual({
      status: 'disabled',
      modelAllowlist: ['gpt-5.5'],
      secret: 'sk-rotated',
    });
  });
});
