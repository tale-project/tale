// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  automationActionQueryAdapters,
  automationPaginatedAdapters,
  automationReadAdapters,
  automationWriteAdapters,
} from './automations';
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

/**
 * A write that may already have happened is read and decided through the
 * run's own doors, and both live under the run's cache key: the run hint a
 * decision emits refreshes the card wherever the run is open.
 */
describe('trigger runs adapter', () => {
  it('reads the runs the trigger started under the run entity, ten by default', async () => {
    const runs = [
      {
        runId: 'r1',
        startedAt: 2,
        status: 'success',
        deliverySource: 'body',
        header: null,
      },
    ];
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { runs }));
    const query = automationReadAdapters[
      'automations/queries:listTriggerRuns'
    ]?.({ organizationId: 'org1', name: 'ops/github sync' }, {});
    // A run hint refreshes it: a new run, or a status one reaches.
    expect(query?.queryKey).toEqual(
      backendKey('org1', 'automation_run', 'trigger', 'ops/github sync', '10'),
    );
    expect(await query?.queryFn()).toEqual(runs);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/github%20sync/trigger/runs?limit=10&orgId=org1',
    );
  });
});

describe('in-doubt adapters', () => {
  it('reads the open in-doubt write under the run', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { inDoubt: { attemptId: 'a1', nodeId: 'send' } }),
      );
    const query = automationReadAdapters['automations/queries:getRunInDoubt']?.(
      { organizationId: 'org1', runId: 'run/1' },
      {},
    );
    expect(query?.queryKey).toEqual(
      backendKey('org1', 'automation_run', 'in-doubt', 'run/1'),
    );
    expect(await query?.queryFn()).toEqual({ attemptId: 'a1', nodeId: 'send' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/runs/run%2F1/in-doubt?orgId=org1',
    );
  });

  it('posts the decision to the attempt and refreshes the runs', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const adapter =
      automationWriteAdapters['automations/mutations:resolveRunInDoubt'];
    await expect(
      adapter?.run(
        {
          organizationId: 'org1',
          runId: 'r1',
          attemptId: 'a/1',
          attempt: 2,
          resolution: 'skip',
        },
        {},
      ),
    ).resolves.toBeNull();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/runs/r1/in-doubt/a%2F1?orgId=org1',
    );
    // The attempt the choice is about: the door refuses an earlier attempt
    // of the same write instead of deciding a later one.
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toEqual({
      resolution: 'skip',
      attempt: 2,
    });

    const client = new QueryClient();
    const card = backendKey('org1', 'automation_run', 'in-doubt', 'r1');
    client.setQueryData(card, { attemptId: 'a/1' });
    adapter?.invalidate?.(client, { organizationId: 'org1' }, {});
    expect(client.getQueryState(card)?.isInvalidated).toBe(true);
    client.clear();
  });

  it('sends no decision that names no attempt', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    const adapter =
      automationWriteAdapters['automations/mutations:resolveRunInDoubt'];
    for (const attempt of [undefined, 0, 1.5, '1']) {
      expect(() =>
        adapter?.run(
          {
            organizationId: 'org1',
            runId: 'r1',
            attemptId: 'a1',
            attempt,
            resolution: 'skip',
          },
          {},
        ),
      ).toThrow('Missing attempt for adapted write');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('node-type catalog adapter', () => {
  const ROW = {
    type: 'github.list_issues',
    kind: 'connector',
    description: 'List issues for a repository.',
    allowedFields: ['input', 'credential'],
    requiredFields: ['input'],
    outputKind: 'structured',
    hasEffect: false,
    connector: 'github',
    title: 'List issues',
    i18n: { de: { title: 'Issues auflisten' } },
  };

  it('reads the actions and the connectors they belong to', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        nodeTypes: [ROW],
        connectors: [
          {
            name: 'github',
            displayName: 'GitHub',
            iconUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
          },
        ],
      }),
    );
    const fetchCatalog = automationActionQueryAdapters[
      'automations/catalog:listNodeTypes'
    ]?.({ organizationId: 'org1' }, {});
    await expect(fetchCatalog?.()).resolves.toEqual({
      nodeTypes: [ROW],
      connectors: [
        {
          name: 'github',
          displayName: 'GitHub',
          iconUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
        },
      ],
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/catalog/node-types?orgId=org1',
    );
  });

  it('refuses an answer in a shape it does not read, instead of casting it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { nodeTypes: [{ ...ROW, kind: 'plugin' }] }),
    );
    const fetchCatalog = automationActionQueryAdapters[
      'automations/catalog:listNodeTypes'
    ]?.({ organizationId: 'org1' }, {});
    await expect(fetchCatalog?.()).rejects.toThrow(/unreadable shape/);
    expect(warn).toHaveBeenCalled();
  });

  it('reads an answer without connectors as none', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { nodeTypes: [ROW] }),
    );
    const fetchCatalog = automationActionQueryAdapters[
      'automations/catalog:listNodeTypes'
    ]?.({ organizationId: 'org1' }, {});
    await expect(fetchCatalog?.()).resolves.toEqual({
      nodeTypes: [ROW],
      connectors: [],
    });
  });
});

describe('version history adapters [AUTO-R47]', () => {
  it('reads a page of versions, parsing each row at the boundary', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        versions: [
          {
            version: 4,
            createdBy: 'u2',
            createdAt: 1_000,
            createdVia: 'mcp',
            viaInferred: false,
            clientName: 'Claude Code',
            basedOnVersion: 3,
            restoredFromVersion: null,
            changes: { nodes: { added: 1, removed: 0, changed: 0 } },
            deployed: true,
            lastDeployedAt: 9_000,
          },
        ],
        nextBefore: 4,
        latestVersion: 5,
        deployedVersion: 4,
      }),
    );
    const listing = automationPaginatedAdapters[
      'automations/queries:listVersionHistory'
    ]?.({ organizationId: 'org-1', name: 'ops/greet' }, {});
    // Under the automation's key, so a save's hint refreshes the history.
    expect(listing?.queryKey).toEqual(
      backendKey('org-1', 'automation', 'versions', 'ops/greet', 'history'),
    );
    const page = await listing?.fetchPage('5', 1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/greet/versions?limit=1&before=5&orgId=org-1',
    );
    // A field the server left out reads as unknown, never as absent.
    expect(page?.page[0]).toMatchObject({
      version: 4,
      createdVia: 'mcp',
      message: null,
      testsPassed: null,
      deployed: true,
    });
    expect(page).toMatchObject({ isDone: false, continueCursor: '4' });
  });

  it('asks for the first page without a cursor and ends on the last', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(200, { versions: [], nextBefore: null }));
    const page = await automationPaginatedAdapters[
      'automations/queries:listVersionHistory'
    ]?.({ organizationId: 'org-1', name: 'ops/greet' }, {})?.fetchPage(
      null,
      500,
    );
    // A page never asks for more than the server answers.
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/greet/versions?limit=200&orgId=org-1',
    );
    expect(page).toEqual({ page: [], isDone: true, continueCursor: '' });
  });

  it('refuses a page in a shape it does not read, instead of casting it', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { versions: [{ version: 'four' }] }),
    );
    const listing = automationPaginatedAdapters[
      'automations/queries:listVersionHistory'
    ]?.({ organizationId: 'org-1', name: 'ops/greet' }, {});
    await expect(listing?.fetchPage(null, 1)).rejects.toThrow();
  });

  it('reads the deployment history from where the last page ended', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        live: {
          version: 4,
          deployedAt: 9_000,
          deployedBy: 'u2',
          via: 'app',
          clientName: null,
          activeRuns: 1,
        },
        deployments: [
          {
            id: 'e-4',
            version: 4,
            previousVersion: 5,
            kind: 'rollback',
            synthesized: false,
            deployedAt: 9_000,
            deployedBy: 'u2',
            via: 'app',
            clientName: null,
          },
        ],
        nextBefore: null,
      }),
    );
    const read = automationReadAdapters[
      'automations/queries:listDeployments'
    ]?.(
      {
        organizationId: 'org-1',
        name: 'ops/greet',
        limit: 10,
        before: { at: 9_500, id: 'e-5' },
      },
      {},
    );
    const history = (await read?.queryFn()) as {
      deployments: Array<{ kind: string }>;
    };
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/greet/deployments?limit=10&before=9500%3Ae-5&orgId=org-1',
    );
    expect(history.deployments[0]?.kind).toBe('rollback');
  });

  it('pages the deployment history from where the last page ended', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        live: null,
        deployments: [
          {
            id: 'e-3',
            version: 3,
            previousVersion: null,
            deployedAt: 8_000,
            deployedBy: 'u2',
            via: 'mcp',
            clientName: 'Claude Code',
          },
        ],
        nextBefore: { at: 8_000, id: 'e-3' },
      }),
    );
    const listing = automationPaginatedAdapters[
      'automations/queries:listDeploymentsPaginated'
    ]?.({ organizationId: 'org-1', name: 'ops/greet' }, {});
    expect(listing?.queryKey).toEqual(
      backendKey('org-1', 'automation', 'deployments', 'ops/greet', 'history'),
    );
    const page = await listing?.fetchPage('9500:e-5', 50);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/greet/deployments?limit=50&before=9500%3Ae-5&orgId=org-1',
    );
    expect(page).toMatchObject({
      page: [{ version: 3, kind: 'deploy', clientName: 'Claude Code' }],
      isDone: false,
      continueCursor: '8000:e-3',
    });
  });

  it('lists every version parsed like a page of the history', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        versions: [
          {
            version: 2,
            createdBy: 'api-key:u1',
            createdAt: 2_000,
            createdVia: 'mcp',
            clientName: 'Claude Code',
            restoredFromVersion: 1,
          },
          { version: 1, createdBy: 'u1', createdAt: 1_000 },
        ],
        nextBefore: null,
      }),
    );
    const read = automationReadAdapters['automations/queries:listVersions']?.(
      { organizationId: 'org-1', name: 'ops/greet' },
      {},
    );
    const versions = (await read?.queryFn()) as Array<Record<string, unknown>>;
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    // Who saved it and how reads through; what a server leaves out is
    // unknown, never absent.
    expect(versions[0]).toMatchObject({
      createdVia: 'mcp',
      clientName: 'Claude Code',
      restoredFromVersion: 1,
      message: null,
    });
    expect(versions[1]).toMatchObject({ createdVia: null, message: null });
  });

  it('restores a version through its door', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(
        jsonResponse(201, { name: 'ops/greet', version: 6, restoredFrom: 2 }),
      );
    await automationWriteAdapters[
      'automations/mutations:restoreAutomationVersion'
    ]?.run(
      {
        organizationId: 'org-1',
        name: 'ops/greet',
        version: 2,
        baseVersion: 5,
      },
      {},
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/app/automations/ops/greet/restore?orgId=org-1',
      expect.anything(),
    );
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toEqual({
      version: 2,
      baseVersion: 5,
    });
  });

  it('carries the live version a deploy expects, null included', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () =>
        jsonResponse(200, { name: 'ops/greet', version: 2 }),
      );
    const deploy =
      automationWriteAdapters['automations/mutations:deployAutomation'];
    await deploy?.run(
      {
        organizationId: 'org-1',
        name: 'ops/greet',
        version: 2,
        expectedDeployedVersion: null,
      },
      {},
    );
    await deploy?.run(
      { organizationId: 'org-1', name: 'ops/greet', version: 2 },
      {},
    );
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toEqual({
      version: 2,
      expectedDeployedVersion: null,
    });
    expect(jsonBody(fetchSpy.mock.calls[1]?.[1])).toEqual({ version: 2 });
  });

  it('records what a draft was built from on a save', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(jsonResponse(201, { name: 'ops/greet', version: 7 }));
    await automationWriteAdapters['automations/mutations:saveAutomation']?.run(
      {
        organizationId: 'org-1',
        automation: { version: 1, name: 'ops/greet', nodes: [] },
        basedOnVersion: 5,
      },
      {},
    );
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toMatchObject({
      basedOnVersion: 5,
    });
  });
});

describe('bench adapters [AUTO-R50]', () => {
  const RUN = {
    status: 'success',
    output: 14,
    trace: [{ node: 'double', type: 'transform', status: 'ok', output: 14 }],
    effects: [],
    ms: 1.2,
    documentHash: 'abc123',
  };

  it('tries a draft, or a saved version, through its door', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () =>
        jsonResponse(200, { run: RUN, warnings: [] }),
      );
    const tryIt =
      automationWriteAdapters['automations/mutations:tryAutomation'];
    const answer = await tryIt?.run(
      {
        organizationId: 'org-1',
        name: 'ops/double',
        document: { version: 1, name: 'ops/double', nodes: [] },
        input: { n: 7 },
        bench: { mocks: { fetch: [] } },
      },
      {},
    );
    expect(answer).toMatchObject({ run: { output: 14 } });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/double/try?orgId=org-1',
    );
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toEqual({
      document: { version: 1, name: 'ops/double', nodes: [] },
      input: { n: 7 },
      bench: { mocks: { fetch: [] } },
    });
    await tryIt?.run(
      { organizationId: 'org-1', name: 'ops/double', version: 3 },
      {},
    );
    expect(jsonBody(fetchSpy.mock.calls[1]?.[1])).toEqual({ version: 3 });
  });

  it('refuses a try answer in a shape it does not read', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, { run: { status: 'maybe' }, warnings: [] }),
    );
    await expect(
      automationWriteAdapters['automations/mutations:tryAutomation']?.run(
        { organizationId: 'org-1', name: 'ops/double', version: 3 },
        {},
      ),
    ).rejects.toThrow();
  });

  it('runs tests by hand and refreshes the version reads when it records a verdict', async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        report: {
          passed: 1,
          failed: 0,
          results: [{ name: 'doubles', index: 0, pass: true, ms: 1 }],
        },
        recorded: { version: 3, testsPassed: true, checkedAt: 5 },
      }),
    );
    const run =
      automationWriteAdapters['automations/mutations:runAutomationTests'];
    const answer = await run?.run(
      { organizationId: 'org-1', name: 'ops/double', version: 3, tests: [0] },
      {},
    );
    expect(answer).toMatchObject({ recorded: { testsPassed: true } });
    expect(jsonBody(fetchSpy.mock.calls[0]?.[1])).toEqual({
      version: 3,
      tests: [0],
    });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    run?.invalidate?.(
      client,
      { organizationId: 'org-1', name: 'ops/double' },
      {},
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("reads a version's last test check under the automation's keys", async () => {
    const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        report: null,
        testsPassed: false,
        testsCheckedAt: 5,
        via: 'deploy',
        by: 'user-1',
      }),
    );
    const read =
      automationReadAdapters['automations/queries:getAutomationTestReport'];
    const query = read?.(
      { organizationId: 'org-1', name: 'ops/double', version: 3 },
      {},
    );
    expect(query?.queryKey).toEqual(
      backendKey('org-1', 'automation', 'test_report', 'ops/double', '3'),
    );
    expect(await query?.queryFn()).toMatchObject({ via: 'deploy' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      '/api/app/automations/ops/double/test-report?version=3&orgId=org-1',
    );
    expect(
      read?.({ organizationId: 'org-1', name: 'ops/double' }, {}),
    ).toBeNull();
  });
});
