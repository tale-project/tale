// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automationReadAdapters, automationWriteAdapters } from './automations';
import { backendKey } from './query-keys';

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

it('separates agent-step transcript cache keys and carries the selector over HTTP', async () => {
  const fetchSpy = vi
    .spyOn(window, 'fetch')
    .mockImplementation(async () =>
      jsonResponse(200, { op: { execId: 'draft-exec' } }),
    );
  const adapter =
    automationReadAdapters[
      'sandbox/session_queries_public:getAgentNodeSandboxOp'
    ];
  const args = { organizationId: 'org1', runId: 'run/1' };
  const draft = adapter?.({ ...args, nodeId: 'draft/report' }, {});
  const review = adapter?.({ ...args, nodeId: 'review_report' }, {});
  const latest = adapter?.(args, {});
  expect(draft?.queryKey).not.toEqual(review?.queryKey);
  expect(draft?.queryKey).not.toEqual(latest?.queryKey);
  expect(adapter?.({ ...args, nodeId: 123 }, {})).toBeNull();
  expect(await draft?.queryFn()).toEqual({ execId: 'draft-exec' });
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(
    '/api/app/sandbox/agent-node-op?runId=run%2F1&nodeId=draft%2Freport&orgId=org1',
  );
  await latest?.queryFn();
  expect(fetchSpy.mock.calls[1]?.[0]).toBe(
    '/api/app/sandbox/agent-node-op?runId=run%2F1&orgId=org1',
  );
});

it.each([null, 'p1'])(
  'normalizes run project scope %s for continuation pickers',
  async (projectId) => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { run: { id: 'r1', projectId } }),
    );
    const query = automationReadAdapters['automations/queries:getRun']?.(
      { organizationId: 'org1', runId: 'r1' },
      {},
    );
    expect(query).toBeTruthy();
    const run = await query?.queryFn();
    expect(run).toMatchObject({ id: 'r1', projectId: projectId ?? undefined });
  },
);

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

  it('forwards the version the draft started from', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(201, { name: 'ops/greet', version: 7 }));

    await automationWriteAdapters['automations/mutations:saveAutomation']?.run(
      {
        organizationId: 'org-1',
        automation: { version: 1, name: 'ops/greet', nodes: [] },
        baseVersion: 6,
      },
      {},
    );

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(jsonBody(init)).toMatchObject({ baseVersion: 6 });
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

describe('approval decision adapter', () => {
  // The card that pressed Approve reads the recorded decision back from the
  // approval itself; before, only the run lists refreshed, so the card kept
  // offering the decision until the approval hint arrived.
  it('refreshes the decided approval of this organization only', () => {
    const client = new QueryClient();
    const own = backendKey('org-a', 'approval', 'detail', 'approval-a');
    const other = backendKey('org-b', 'approval', 'detail', 'approval-b');
    client.setQueryData(own, { status: 'pending' });
    client.setQueryData(other, { status: 'pending' });
    automationWriteAdapters[
      'approvals/mutations:updateApprovalStatus'
    ]?.invalidate?.(
      client,
      { approvalId: 'approval-a' },
      {
        organizationId: 'org-a',
      },
    );
    expect(client.getQueryState(own)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});
