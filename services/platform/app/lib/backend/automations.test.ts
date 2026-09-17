// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationWriteAdapters } from './automations';

/**
 * The save adapter carries the wizard's whole contract to the store door:
 * `create` (create-only — a colliding slug is refused, never appended to)
 * and `projectId` (the install target that binds version 1). Regression:
 * the body once dropped `create`, so the store never saw it.
 */

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

describe('saveAutomation adapter', () => {
  it('forwards create and projectId to the save door', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(201, { name: 'ops/greet', version: 1 }));

    await automationWriteAdapters['automations/mutations:saveAutomation']?.run(
      {
        organizationId: 'org-1',
        automation: { version: 1, name: 'ops/greet', nodes: [] },
        message: 'first',
        create: true,
        projectId: 'p1',
      },
      {},
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/automations/ops/greet/save?orgId=org-1',
      expect.anything(),
    );
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(jsonBody(init)).toEqual({
      document: { version: 1, name: 'ops/greet', nodes: [] },
      message: 'first',
      create: true,
      projectId: 'p1',
    });
  });

  it('omits create when the save is a plain version append', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(201, { name: 'ops/greet', version: 2 }));

    await automationWriteAdapters['automations/mutations:saveAutomation']?.run(
      {
        organizationId: 'org-1',
        automation: { version: 1, name: 'ops/greet', nodes: [] },
      },
      {},
    );

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(jsonBody(init)).not.toHaveProperty('create');
    expect(jsonBody(init)).not.toHaveProperty('projectId');
  });
});
