import { Hono, type Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runTestsAnswerSchema,
  tryAnswerSchema,
} from '../../../lib/shared/schemas/automation-tests.ts';
import type { OrgEnv } from '../../auth/org.ts';
import { RateLimitExceededError } from '../../lib/rate-limit.ts';

/**
 * The runs that are never stored, at the app door: a try of a draft or a
 * saved version, the tests run by hand, and a version's last test report —
 * what each answers, refuses and records, with the engine's own checks and
 * runs.
 */

const io = vi.hoisted(() => ({
  stored: {} as unknown,
  charge: vi.fn(),
  record: vi.fn(),
  report: vi.fn(),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', { user: { id: 'u1' } } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (original) => ({
  ...(await original<typeof import('../../auth/org.ts')>()),
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'developer' } as never);
      await next();
    },
}));
vi.mock('../../core/connector_credentials/connector_catalog.ts', () => ({
  loadConnectorDefinitions: () => [],
}));
vi.mock('../../lib/rate-limit.ts', async (original) => ({
  ...(await original<typeof import('../../lib/rate-limit.ts')>()),
  checkOrganizationRateLimit: io.charge,
}));
vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  recordTestVerdict: io.record,
}));
vi.mock('./versions.ts', async (original) => ({
  ...(await original<typeof import('./versions.ts')>()),
  readTestReport: io.report,
}));
vi.mock('./dispatch-store.ts', () => ({
  pgAutomationStore: () => ({
    list: async () => [],
    get: async (_name: string, version?: number) =>
      version === 9 ? null : { meta: { version: 2 }, automation: io.stored },
    deployedVersion: async () => null,
  }),
}));

import { admitBenchRun, BENCH_CONCURRENCY } from './bench.ts';
import { createAutomationRoutes } from './routes.ts';

function document(tests: unknown[] = []) {
  return {
    version: 1,
    name: 'double',
    nodes: [
      {
        id: 'double',
        type: 'transform',
        input: { n: '{{ input.n }}' },
        code: 'return input.n * 2;',
      },
    ],
    output: '{{ nodes.double.output }}',
    ...(tests.length > 0 && { tests }),
  };
}

const PASSING = {
  name: 'doubles seven',
  input: { n: 7 },
  expect: { output: 14 },
};
const FAILING = {
  name: 'triples seven',
  input: { n: 7 },
  expect: { output: 21 },
};

async function request(path: string, init: { body?: unknown } = {}) {
  const app = new Hono().route(
    '/api/app/automations',
    createAutomationRoutes({ sql: {} as never, auth: {} as never }),
  );
  return app.request(
    `/api/app/automations${path}`,
    init.body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(init.body),
        },
  );
}

/** How many of this process's places for bench runs are free: every one it
 * can take, taken and given back. */
function freePlaces(): number {
  const held: Array<() => void> = [];
  for (;;) {
    const place = admitBenchRun();
    if (place === null) break;
    held.push(place);
  }
  for (const release of held) release();
  return held.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.stored = document([PASSING]);
  io.charge.mockResolvedValue(undefined);
});

describe('POST /:name/try', () => {
  it('runs the draft once with its input, recorded and never stored', async () => {
    const res = await request('/double/try', {
      body: { document: document(), input: { n: 7 } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: {
        status: string;
        output: unknown;
        documentHash: string;
        record?: unknown;
        version?: number;
      };
      warnings: unknown[];
    };
    expect(body.run.status).toBe('success');
    expect(body.run.output).toBe(14);
    expect(body.run.documentHash).toMatch(/^[0-9a-z]+$/);
    expect(body.run.record).toBeDefined();
    expect(body.run.version).toBeUndefined();
    // The app reads the answer through the shared schema.
    expect(tryAnswerSchema.safeParse(body).success).toBe(true);
    // Charged once, and its place in the process given back.
    expect(io.charge).toHaveBeenCalledWith({}, 'automation:bench', 'o1', 1);
    expect(freePlaces()).toBe(BENCH_CONCURRENCY);
  });

  it('runs a saved version the request names', async () => {
    const res = await request('/double/try', {
      body: { version: 2, input: { n: 3 } },
    });
    const body = (await res.json()) as {
      run: { output: unknown; version?: number };
    };
    expect(body.run.output).toBe(6);
    expect(body.run.version).toBe(2);
  });

  it('asks for the draft or a saved version, one of the two', async () => {
    const both = await request('/double/try', {
      body: { document: document(), version: 2 },
    });
    expect(both.status).toBe(400);
    const none = await request('/double/try', { body: { input: {} } });
    expect(none.status).toBe(400);
    const missing = await request('/double/try', { body: { version: 9 } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: 'AUTOMATION_VERSION_UNKNOWN',
    });
  });

  it('refuses a draft that does not pass the checks, with its problems', async () => {
    const res = await request('/double/try', {
      body: {
        document: {
          ...document(),
          output: '{{ nodes.missing.output }}',
        },
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      data: { errors: Array<{ code: string }> };
    };
    expect(body.error).toBe('AUTOMATION_INVALID');
    expect(body.data.errors.length).toBeGreaterThan(0);
    expect(io.charge).not.toHaveBeenCalled();
  });

  it('refuses a stand-in for a node the draft does not have', async () => {
    const res = await request('/double/try', {
      body: {
        document: document(),
        input: { n: 1 },
        bench: { mocks: { nowhere: 1 } },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'BENCH_INVALID' });
    expect(freePlaces()).toBe(BENCH_CONCURRENCY);
  });

  it('refuses a stand-in past what a door takes', async () => {
    const res = await request('/double/try', {
      body: {
        document: document(),
        bench: { mocks: { double: 'x'.repeat(70_000) } },
      },
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      data: { field: 'bench.mocks.double', limitBytes: 65_536 },
    });
  });

  it('answers 429 with Retry-After when the budget is spent or the server is busy', async () => {
    io.charge.mockRejectedValueOnce(
      new RateLimitExceededError('spent', 30_000),
    );
    const spent = await request('/double/try', {
      body: { document: document(), input: { n: 1 } },
    });
    expect(spent.status).toBe(429);
    expect(spent.headers.get('retry-after')).toBe('30');
    const held = Array.from({ length: BENCH_CONCURRENCY }, () =>
      admitBenchRun(),
    );
    const busy = await request('/double/try', {
      body: { document: document(), input: { n: 1 } },
    });
    for (const place of held) place?.();
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('2');
  });
});

describe('POST /:name/run-tests', () => {
  it("records a saved version's whole suite as its verdict, made by hand [AUTO-R50]", async () => {
    io.stored = document([PASSING, FAILING]);
    const res = await request('/double/run-tests', { body: { version: 2 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      report: {
        passed: number;
        failed: number;
        results: Array<{ run?: unknown }>;
      };
      recorded: { version: number; testsPassed: boolean; checkedAt: number };
    };
    expect(body.report).toMatchObject({ passed: 1, failed: 1 });
    // Each test's run comes back with it.
    expect(body.report.results[0]?.run).toBeDefined();
    expect(body.recorded).toMatchObject({ version: 2, testsPassed: false });
    expect(runTestsAnswerSchema.safeParse(body).success).toBe(true);
    expect(io.charge).toHaveBeenCalledWith({}, 'automation:bench', 'o1', 2);
    expect(io.record).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        organizationId: 'o1',
        name: 'double',
        version: 2,
        testsPassed: false,
        at: body.recorded.checkedAt,
        check: expect.objectContaining({ via: 'manual', by: 'u1' }),
      }),
    );
  });

  it('records nothing for a subset, or for a draft [AUTO-R50]', async () => {
    io.stored = document([PASSING, FAILING]);
    const subset = await request('/double/run-tests', {
      body: { version: 2, tests: [0] },
    });
    expect(await subset.json()).toMatchObject({
      report: { passed: 1, failed: 0 },
    });
    const draft = await request('/double/run-tests', {
      body: { document: document([PASSING]) },
    });
    expect(await draft.json()).toMatchObject({ report: { passed: 1 } });
    expect(io.record).not.toHaveBeenCalled();
  });

  it('answers an empty report for a document without tests, charging nothing', async () => {
    const res = await request('/double/run-tests', {
      body: { document: document() },
    });
    expect(await res.json()).toEqual({
      report: { passed: 0, failed: 0, results: [] },
    });
    expect(io.charge).not.toHaveBeenCalled();
  });
});

describe('GET /:name/test-report', () => {
  it("answers a version's last check, or says the version is not there", async () => {
    io.report.mockResolvedValueOnce({
      report: null,
      testsPassed: true,
      testsCheckedAt: 5,
      via: 'save',
      by: 'u1',
    });
    const found = await request('/double/test-report?version=2');
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      testsPassed: true,
      via: 'save',
    });
    io.report.mockResolvedValueOnce(undefined);
    const missing = await request('/double/test-report?version=9');
    expect(missing.status).toBe(404);
    const bad = await request('/double/test-report?version=x');
    expect(bad.status).toBe(400);
  });
});
