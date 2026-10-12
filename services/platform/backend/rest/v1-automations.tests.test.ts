// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAutomationTests } from '../../lib/engine/api/tests.ts';
import {
  versionTestsReadSchema,
  versionTestsRunSchema,
} from '../../lib/shared/schemas/automation-tests.ts';
import { memberNamesOf } from '../domains/automations/author-names.ts';
import { pgAutomationStore } from '../domains/automations/dispatch-store.ts';
import {
  automationExists,
  bindingProjectIds,
} from '../domains/automations/store.ts';
import { readTestReport } from '../domains/automations/versions.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../lib/rate-limit.ts';
import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

/**
 * A saved version's tests on the REST door: a release pipeline runs them —
 * all, or those it names — and reads the verdict the version carries. The
 * store is a double and the runner is too (the run of a test needs the
 * engine's code runner, which the double does not install); what they do is
 * their own tests': `dispatch.bench.test.ts`, `tests.test.ts`,
 * `version-doors.integration.ts`.
 */

vi.mock('../domains/automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/automations/store.ts')>()),
  automationExists: vi.fn(),
  bindingProjectIds: vi.fn(async () => []),
}));
vi.mock('../domains/automations/versions.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/automations/versions.ts')
  >()),
  readTestReport: vi.fn(),
}));
vi.mock('../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/rate-limit.ts')>()),
  checkUserRateLimit: vi.fn(async () => undefined),
}));
vi.mock('../domains/automations/author-names.ts', () => ({
  memberNamesOf: vi.fn(),
}));
vi.mock('../domains/automations/dispatch-store.ts', () => ({
  pgAutomationStore: vi.fn(),
}));
vi.mock('../../lib/engine/api/tests.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/engine/api/tests.ts')>()),
  runAutomationTests: vi.fn(),
}));
vi.mock('../core/automations/authoring_host.ts', () => ({
  assembleAutomationAuthoringHost: vi.fn(),
}));

const NAME = 'billing/dunning';
const SLUG = 'billing__dunning';

const passing = (name: string, index: number) => ({
  name,
  index,
  pass: true,
  ms: 1,
});

/** The saved document of version `n`: three tests from version 3 on, none
 * before, and from version 5 on a document that no longer passes the
 * checks. */
const docOf = (n: number) => ({
  version: 1,
  name: NAME,
  description: `version ${String(n)}`,
  nodes: [{ id: 'one', type: 'transform', code: 'return 1;' }],
  output: n === 5 ? '{{ nodes.gone.output }}' : '{{ nodes.one.output }}',
  ...(n >= 3
    ? {
        tests: ['happy', 'sad', 'tipsy'].map((name) => ({
          name,
          input: {},
          expect: { output: 1 },
        })),
      }
    : {}),
});

/** The engine store the run and its verdict go through. */
const engine = {
  get: vi.fn(),
  deployedVersion: vi.fn(),
  recordTestVerdict: vi.fn(),
  admitBench: vi.fn(),
};

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    return Promise.resolve([]);
  };
  const begin = (
    options: string | ((tx: unknown) => Promise<unknown>),
    callback?: (tx: unknown) => Promise<unknown>,
  ) => (typeof options === 'function' ? options(sql) : callback?.(sql));
  const sql = Object.assign(tag, { unsafe: (t: string) => t, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

function mount(options: { role?: string } = {}) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('apiKeyId', 'key-1');
    c.set('userId', 'user-ada');
    c.set('userEmail', 'ada@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql: fakeSql() }));
  return app;
}

const url = (path: string) =>
  `http://localhost/api/v1/automations/${SLUG}${path}`;
const post = (
  app: ReturnType<typeof mount>,
  path: string,
  body?: unknown,
  name = SLUG,
) =>
  app.request(`http://localhost/api/v1/automations/${name}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const release = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(automationExists).mockImplementation(
    async (_sql, _org, name) => name === NAME,
  );
  vi.mocked(bindingProjectIds).mockResolvedValue([]);
  vi.mocked(memberNamesOf).mockImplementation(
    async (_sql, _org, actors) =>
      new Map(
        actors.map((actor) => [
          actor,
          actor.endsWith('user-ada') ? 'Ada Lovelace' : null,
        ]),
      ),
  );
  vi.mocked(runAutomationTests).mockResolvedValue({
    passed: 3,
    failed: 0,
    results: [passing('happy', 0), passing('sad', 1), passing('tipsy', 2)],
  });
  engine.get.mockImplementation(async (name: string, version?: number) =>
    name === NAME && (version === undefined || (version >= 1 && version <= 5))
      ? { meta: { version: version ?? 5 }, automation: docOf(version ?? 5) }
      : null,
  );
  engine.deployedVersion.mockResolvedValue(3);
  engine.recordTestVerdict.mockResolvedValue(undefined);
  engine.admitBench.mockResolvedValue(release);
  vi.mocked(pgAutomationStore).mockImplementation(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the slice of the store these routes use
    () => ({ ...engine, list: async () => [] }) as never,
  );
});

describe('POST /automations/{name}/versions/{version}/tests', () => {
  it('runs the whole suite of a saved version, answers the report and records the verdict as made by hand with the key [AUTO-R55]', async () => {
    const res = await post(mount(), '/versions/3/tests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      name: NAME,
      version: 3,
      passed: 3,
      failed: 0,
      results: [passing('happy', 0), passing('sad', 1), passing('tipsy', 2)],
      recorded: { version: 3, testsPassed: true },
    });
    // The shared reader accepts what REST sends.
    expect(versionTestsRunSchema.safeParse(body).success).toBe(true);
    expect(engine.recordTestVerdict).toHaveBeenCalledWith(NAME, 3, true, {
      via: 'manual',
      report: expect.objectContaining({ passed: 3 }),
    });
    // The store acts for the key: its door, its person, only what it sees.
    expect(pgAutomationStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        visibleOnly: true,
        origin: expect.objectContaining({
          actor: 'api-key:user-ada',
          via: 'rest',
          apiKeyId: 'key-1',
        }),
      }),
    );
  });

  it('records a failing suite as failing, and says so [AUTO-R55]', async () => {
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 2,
      failed: 1,
      results: [
        passing('happy', 0),
        {
          name: 'sad',
          index: 1,
          pass: false,
          ms: 1,
          message: 'output mismatch',
          failures: [
            { kind: 'output', mode: 'exact', mismatches: [], total: 1 },
          ],
        },
        passing('tipsy', 2),
      ],
    });
    const body = await (await post(mount(), '/versions/3/tests')).json();
    expect(body).toMatchObject({
      passed: 2,
      failed: 1,
      recorded: { version: 3, testsPassed: false },
    });
    expect(body.results[1].failures[0]).toMatchObject({ kind: 'output' });
  });

  it('runs only the tests it names, by name, and records nothing for a part of the suite [AUTO-R55]', async () => {
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 2,
      failed: 0,
      results: [passing('happy', 0), passing('tipsy', 2)],
    });
    const body = await (
      await post(mount(), '/versions/3/tests', { tests: ['tipsy', 'happy'] })
    ).json();
    expect(body).toMatchObject({ name: NAME, version: 3, passed: 2 });
    expect(body).not.toHaveProperty('recorded');
    expect(runAutomationTests).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ select: [0, 2], version: 3 }),
    );
    expect(engine.recordTestVerdict).not.toHaveBeenCalled();
  });

  it('answers only the parts of each run it asks for with detail [AUTO-R55]', async () => {
    vi.mocked(runAutomationTests).mockResolvedValue({
      passed: 1,
      failed: 0,
      results: [
        {
          ...passing('happy', 0),
          run: {
            status: 'success',
            output: 1,
            effects: [],
            record: { id: 'test-0' } as never,
          },
        },
      ],
    });
    const body = await (
      await post(mount(), '/versions/3/tests', {
        tests: ['happy'],
        detail: ['output'],
      })
    ).json();
    expect(runAutomationTests).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ detail: true }),
    );
    expect(body.results[0].run).toEqual({ status: 'success', output: 1 });
  });

  it('refuses a test the version does not have, naming the tests it has, and runs nothing [AUTO-R55]', async () => {
    const res = await post(mount(), '/versions/3/tests', { tests: ['hapy'] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_BODY');
    expect(body.data.issues).toEqual([
      {
        path: 'tests',
        message: expect.stringContaining('did you mean "happy"?'),
      },
    ]);
    expect(body.data.issues[0].message).toContain('happy, sad, tipsy');
    expect(runAutomationTests).not.toHaveBeenCalled();
    expect(engine.admitBench).not.toHaveBeenCalled();
  });

  it('refuses a body it does not take before charging anything', async () => {
    for (const bad of [
      { tests: [] },
      { tests: [''] },
      { tests: 'happy' },
      { detail: ['everything'] },
      { detail: 'output' },
      { extra: true },
    ]) {
      const res = await post(mount(), '/versions/3/tests', bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect((await res.json()).code).toBe('INVALID_BODY');
    }
    expect(checkUserRateLimit).not.toHaveBeenCalled();
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it('runs the whole suite when no body is sent at all', async () => {
    const res = await post(mount(), '/versions/3/tests');
    expect(res.status).toBe(200);
    expect(runAutomationTests).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ select: expect.anything() }),
    );
  });

  it('answers an empty report for a version without tests, charging no bench budget and recording nothing', async () => {
    const res = await post(mount(), '/versions/2/tests');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: NAME,
      version: 2,
      passed: 0,
      failed: 0,
      results: [],
    });
    expect(engine.admitBench).not.toHaveBeenCalled();
    expect(engine.recordTestVerdict).not.toHaveBeenCalled();
  });

  it('refuses a version that no longer passes the checks, with its problems [AUTO-R55]', async () => {
    const res = await post(mount(), '/versions/5/tests');
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('AUTOMATION_INVALID');
    expect(body.data.errors.length).toBeGreaterThan(0);
    expect(runAutomationTests).not.toHaveBeenCalled();
    expect(engine.recordTestVerdict).not.toHaveBeenCalled();
  });

  it.each([
    ['an automation nobody saved', '/versions/3/tests', 'nobody__saved'],
    ['a version it never had', '/versions/9/tests', SLUG],
    ['a version that is not a number', '/versions/latest/tests', SLUG],
    ['version zero', '/versions/0/tests', SLUG],
  ])('answers 404 for %s', async (_what, path, slug) => {
    const res = await post(mount(), path, undefined, slug);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(
      slug === SLUG ? 'AUTOMATION_VERSION_UNKNOWN' : 'AUTOMATION_NOT_FOUND',
    );
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it('answers an automation installed only in a project the key holder cannot read as one nobody saved', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    const res = await post(mount({ role: 'member' }), '/versions/3/tests');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('AUTOMATION_NOT_FOUND');
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it("lets a member's key run the tests: they run on the mocks and reach nothing outside Tale", async () => {
    const res = await post(mount({ role: 'member' }), '/versions/3/tests');
    expect(res.status).toBe(200);
  });

  it('draws one execution from the key holder, before anything is looked up, and one run per test from the organization [AUTO-R55]', async () => {
    await post(mount(), '/versions/3/tests');
    expect(checkUserRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'rest:execute',
      'user-ada',
    );
    expect(engine.admitBench).toHaveBeenCalledWith(3);
    expect(release).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    // A name nobody saved still costs the token: it is a lookup.
    await post(mount(), '/versions/3/tests', undefined, 'nobody__saved');
    expect(checkUserRateLimit).toHaveBeenCalledOnce();
  });

  it('answers 429 with the wait when the key holder has no execution left, and runs nothing', async () => {
    vi.mocked(checkUserRateLimit).mockRejectedValueOnce(
      new RateLimitExceededError('spent', 12_000),
    );
    const res = await post(mount(), '/versions/3/tests');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
    expect(runAutomationTests).not.toHaveBeenCalled();
  });

  it("answers 429 with the wait when the organization's budget for runs that are never stored is spent, and runs nothing [AUTO-R55]", async () => {
    engine.admitBench.mockResolvedValue({ retryAfterMs: 1_500 });
    const res = await post(mount(), '/versions/3/tests');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    expect((await res.json()).code).toBe('RATE_LIMITED');
    expect(runAutomationTests).not.toHaveBeenCalled();
    expect(engine.recordTestVerdict).not.toHaveBeenCalled();
  });

  it('gives the place back when the run throws', async () => {
    vi.mocked(runAutomationTests).mockRejectedValue(new Error('boom'));
    const res = await post(mount(), '/versions/3/tests');
    // A fault is the door's 500, never a refusal.
    expect(res.status).toBe(500);
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('GET /automations/{name}/versions/{version}/tests', () => {
  type Check = NonNullable<Awaited<ReturnType<typeof readTestReport>>>;
  const stored = (overrides: Partial<Check> = {}): Check => ({
    report: {
      checkedAt: 4_000,
      passed: 2,
      failed: 1,
      results: [
        { name: 'happy', index: 0, pass: true, ms: 1 },
        { name: 'sad', index: 1, pass: true, ms: 1 },
        {
          name: 'tipsy',
          index: 2,
          pass: false,
          ms: 2,
          failures: [{ kind: 'timeout' as const, limitMs: 10_000 }],
        },
      ],
    },
    testsPassed: false,
    testsCheckedAt: 4_000,
    via: 'manual',
    by: 'api-key:user-ada',
    ...overrides,
  });

  it("answers the version's latest check: the verdict, when, which act made it and who, and the report [AUTO-R56]", async () => {
    vi.mocked(readTestReport).mockResolvedValue(stored());
    const res = await mount().request(url('/versions/3/tests'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      name: NAME,
      version: 3,
      testsPassed: false,
      testsCheckedAt: 4_000,
      via: 'manual',
      by: 'api-key:user-ada',
      byName: 'Ada Lovelace',
      report: stored().report,
    });
    expect(versionTestsReadSchema.safeParse(body).success).toBe(true);
    expect(readTestReport).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      3,
    );
  });

  it('answers a version with no check as nulls, not as a refusal [AUTO-R56]', async () => {
    vi.mocked(readTestReport).mockResolvedValue({
      report: null,
      testsPassed: null,
      testsCheckedAt: null,
      via: null,
      by: null,
    });
    const body = await (await mount().request(url('/versions/2/tests'))).json();
    expect(body).toEqual({
      name: NAME,
      version: 2,
      testsPassed: null,
      testsCheckedAt: null,
      via: null,
      by: null,
      byName: null,
      report: null,
    });
    expect(versionTestsReadSchema.safeParse(body).success).toBe(true);
  });

  it('names no one for a check made by a former member or the platform', async () => {
    vi.mocked(readTestReport).mockResolvedValue(
      stored({ by: 'system:provisioning' }),
    );
    const body = await (await mount().request(url('/versions/3/tests'))).json();
    expect(body).toMatchObject({ by: 'system:provisioning', byName: null });
  });

  it.each([
    [
      'an automation nobody saved',
      'nobody__saved/versions/3/tests',
      'AUTOMATION_NOT_FOUND',
    ],
    [
      'a version it never had',
      `${SLUG}/versions/9/tests`,
      'AUTOMATION_VERSION_UNKNOWN',
    ],
    [
      'a version that is not a number',
      `${SLUG}/versions/x/tests`,
      'AUTOMATION_VERSION_UNKNOWN',
    ],
  ])('answers 404 for %s', async (_what, path, code) => {
    vi.mocked(readTestReport).mockImplementation(async (_sql, _org, _n, v) =>
      v === 9 ? undefined : stored(),
    );
    const res = await mount().request(
      `http://localhost/api/v1/automations/${path}`,
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe(code);
  });

  it('answers an automation installed only in a project the key holder cannot read as one nobody saved', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    vi.mocked(readTestReport).mockResolvedValue(stored());
    const res = await mount({ role: 'member' }).request(
      url('/versions/3/tests'),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('AUTOMATION_NOT_FOUND');
    expect(readTestReport).not.toHaveBeenCalled();
  });

  it('takes no query parameter', async () => {
    const res = await mount().request(url('/versions/3/tests?version=2'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_QUERY');
  });

  it('charges nothing beyond the general budget a read pays', async () => {
    vi.mocked(readTestReport).mockResolvedValue(stored());
    const res = await mount().request(url('/versions/3/tests'));
    expect(res.status).toBe(200);
    expect(checkUserRateLimit).not.toHaveBeenCalled();
  });
});
