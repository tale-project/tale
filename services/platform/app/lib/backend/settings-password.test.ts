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

describe('users/mutations:updateUserPassword', () => {
  it('sends trigger=forced without requiring an active org', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const adapter = settingsWriteAdapters['users/mutations:updateUserPassword'];
    await adapter?.run(
      { newPassword: 'TaleE2E!Passw0rd-r0!', trigger: 'forced' },
      {},
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/users/update-password');
    expect(jsonBody(init)).toEqual({
      newPassword: 'TaleE2E!Passw0rd-r0!',
      trigger: 'forced',
    });
  });

  it('hands the answered expiry status through, and null without one', async () => {
    // The forced-change wall releases on THIS value — the page never re-reads
    // the status. A backend that predates the field answers null, which the
    // caller falls back to invalidating on.
    const status = {
      expired: false,
      reason: null,
      hasCredential: true,
      daysUntilExpiry: null,
      rotationEnabled: false,
    };
    const adapter = settingsWriteAdapters['users/mutations:updateUserPassword'];
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true, passwordExpiry: status }),
    );
    await expect(
      adapter?.run({ newPassword: 'TaleE2E!Passw0rd-r0!' }, {}),
    ).resolves.toEqual(status);

    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { ok: true }),
    );
    await expect(
      adapter?.run({ newPassword: 'TaleE2E!Passw0rd-r0!' }, {}),
    ).resolves.toBeNull();
  });

  it('still sends currentPassword on a voluntary change', async () => {
    const fetchMock = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const adapter = settingsWriteAdapters['users/mutations:updateUserPassword'];
    await adapter?.run(
      {
        currentPassword: 'old',
        newPassword: 'new',
        trigger: 'voluntary',
      },
      { organizationId: 'org1' },
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/app/users/update-password?orgId=org1');
    expect(jsonBody(init)).toEqual({
      currentPassword: 'old',
      newPassword: 'new',
      trigger: 'voluntary',
    });
  });
});
