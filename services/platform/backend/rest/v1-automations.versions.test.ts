// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAutomationTests } from '../../lib/engine/api/tests.ts';
import {
  versionCompareSchema,
  versionHistorySchema,
} from '../../lib/shared/schemas/automation-versions.ts';
import { memberNamesOf } from '../domains/automations/author-names.ts';
import { listDeploymentEvents } from '../domains/automations/deployments.ts';
import { pgAutomationStore } from '../domains/automations/dispatch-store.ts';
import {
  AutomationError,
  automationExists,
  bindingProjectIds,
} from '../domains/automations/store.ts';
import { listVersionHistory } from '../domains/automations/versions.ts';
import {
  checkUserRateLimit,
  RateLimitExceededError,
} from '../lib/rate-limit.ts';
import { mintCursorFor, type RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

/**
 * Versions on the REST door: the history a page at a time with who saved
 * each version and what it changed, when each went live, two versions
 * compared, and the two writes a release pipeline needs — put a version
 * live and bring an older one back. The store is a double; what it keeps and
 * records is its own tests' (`dispatch-store.authoring.test.ts`,
 * `version-history.integration.ts`).
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
  listVersionHistory: vi.fn(),
}));
vi.mock('../domains/automations/deployments.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/automations/deployments.ts')
  >()),
  listDeploymentEvents: vi.fn(),
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

/** The saved document of version `n`: only its description differs. */
const docOf = (n: number) => ({
  version: 1,
  name: NAME,
  description: `version ${String(n)}`,
  nodes: [{ id: 'one', type: 'transform', code: 'return 1;' }],
  output: '{{ nodes.one.output }}',
  ...(n === 4
    ? {
        tests: [{ name: 'ok', input: {}, expect: { output: 'never' } }],
      }
    : {}),
});

/** A history row as `listVersionHistory` answers it. */
const historyRow = (
  version: number,
  overrides: Record<string, unknown> = {},
) => ({
  version,
  message: version === 1 ? null : `cut ${String(version)}`,
  createdBy: 'api-key:user-ada',
  createdAt: 1_000 + version,
  via: 'mcp' as const,
  viaInferred: false,
  apiKeyId: 'key-1',
  clientName: 'Claude Code',
  basedOnVersion: version > 1 ? version - 1 : null,
  restoredFromVersion: null,
  changes: { nodes: { added: 0, removed: 0, changed: 1 } },
  testsPassed: version === 3 ? true : null,
  testsCheckedAt: version === 3 ? 3_000 : null,
  tests:
    version === 3
      ? { passed: 2, failed: 0, total: 2, via: 'save' as const }
      : null,
  live: version === 3,
  lastDeployedAt: version === 3 ? 3_500 : null,
  ...overrides,
});

/** The engine store the writes and the comparison run on. */
const engine = {
  get: vi.fn(),
  deployedVersion: vi.fn(),
  save: vi.fn(),
  deploy: vi.fn(),
  recordTestVerdict: vi.fn(),
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
const post = (app: ReturnType<typeof mount>, path: string, body?: unknown) =>
  app.request(url(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

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
  vi.mocked(listVersionHistory).mockResolvedValue({
    versions: [historyRow(3), historyRow(2), historyRow(1)],
    nextBefore: null,
    latestVersion: 3,
    deployedVersion: 3,
  });
  // The one version with a test of its own fails it: the run of a test
  // needs the engine's code runner, which the double does not install.
  vi.mocked(runAutomationTests).mockResolvedValue({
    passed: 0,
    failed: 1,
    results: [{ name: 'ok', pass: false, index: 0, ms: 1 }],
  });
  engine.get.mockImplementation(async (name: string, version?: number) =>
    name === NAME && (version === undefined || (version >= 1 && version <= 4))
      ? { meta: { version: version ?? 4 }, automation: docOf(version ?? 4) }
      : null,
  );
  engine.deployedVersion.mockResolvedValue(3);
  engine.save.mockResolvedValue({ name: NAME, version: 5 });
  engine.deploy.mockResolvedValue({
    name: NAME,
    version: 2,
    previousVersion: 3,
    kind: 'rollback',
    deploymentId: 'event-9',
    trigger: null,
  });
  vi.mocked(pgAutomationStore).mockImplementation(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the slice of the store these routes use
    () => ({ ...engine, list: async () => [] }) as never,
  );
});

describe('GET /automations/{name}/versions', () => {
  it('answers the whole history in one page, each version with its door, author, lineage, changes and tests [AUTO-R47]', async () => {
    const res = await mount().request(url('/versions'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: NAME,
      deployedVersion: 3,
      latestVersion: 3,
      isDone: true,
      continueCursor: '',
    });
    expect(body.versions).toHaveLength(3);
    expect(body.versions[0]).toEqual({
      version: 3,
      message: 'cut 3',
      testsPassed: true,
      testsCheckedAt: 3_000,
      createdBy: 'api-key:user-ada',
      createdByName: 'Ada Lovelace',
      createdAt: 1_003,
      createdVia: 'mcp',
      viaInferred: false,
      clientName: 'Claude Code',
      basedOnVersion: 2,
      restoredFromVersion: null,
      changes: { nodes: { added: 0, removed: 0, changed: 1 } },
      tests: { passed: 2, failed: 0, total: 2, via: 'save' },
      deployed: true,
      lastDeployedAt: 3_500,
    });
    // What a version never had is null, as the listing has always said.
    expect(body.versions[2]).toMatchObject({
      version: 1,
      message: null,
      testsPassed: null,
      testsCheckedAt: null,
      basedOnVersion: null,
      deployed: false,
    });
    // One shape for every door: the shared reader accepts what REST sends.
    expect(
      versionHistorySchema.safeParse({
        versions: body.versions,
        deployedVersion: body.deployedVersion,
        latestVersion: body.latestVersion,
        nextBefore: null,
      }).success,
    ).toBe(true);
    // Whole history, read in pages of the most one read holds.
    expect(listVersionHistory).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 200 },
    );
  });

  it('reads every page of a long history when no limit is named', async () => {
    vi.mocked(listVersionHistory)
      .mockResolvedValueOnce({
        versions: [historyRow(3), historyRow(2)],
        nextBefore: 2,
        latestVersion: 3,
        deployedVersion: 3,
      })
      .mockResolvedValueOnce({
        versions: [historyRow(1)],
        nextBefore: null,
        latestVersion: 3,
        deployedVersion: 3,
      });
    const body = await (await mount().request(url('/versions'))).json();
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([
      3, 2, 1,
    ]);
    expect(body).toMatchObject({ isDone: true, continueCursor: '' });
    expect(listVersionHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 200, before: 2 },
    );
  });

  it('pages with a signed cursor when a limit is named, and ends with isDone', async () => {
    vi.mocked(listVersionHistory).mockResolvedValueOnce({
      versions: [historyRow(3), historyRow(2)],
      nextBefore: 2,
      latestVersion: 3,
      deployedVersion: 3,
    });
    const first = await (
      await mount().request(url('/versions?limit=2'))
    ).json();
    expect(first.versions).toHaveLength(2);
    expect(first.isDone).toBe(false);
    // Signed for this organization and this list: only it redeems it.
    expect(first.continueCursor).toBe(
      mintCursorFor('org-1', `automation-versions:${NAME}`, '2'),
    );
    expect(listVersionHistory).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 2 },
    );

    vi.mocked(listVersionHistory).mockResolvedValueOnce({
      versions: [historyRow(1)],
      nextBefore: null,
      latestVersion: 3,
      deployedVersion: 3,
    });
    const next = await (
      await mount().request(
        url(
          `/versions?limit=2&cursor=${encodeURIComponent(first.continueCursor)}`,
        ),
      )
    ).json();
    expect(next).toMatchObject({ isDone: true, continueCursor: '' });
    expect(listVersionHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 2, before: 2 },
    );
  });

  it('clamps a limit past what one page holds, and refuses one that is not a number', async () => {
    await mount().request(url('/versions?limit=5000'));
    expect(listVersionHistory).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 200 },
    );
    const bad = await mount().request(url('/versions?limit=many'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });

  it('refuses a cursor this list did not answer, and a parameter it does not take', async () => {
    for (const cursor of [
      'forged',
      mintCursorFor('org-1', 'automation-deployments:billing/dunning', '2'),
      mintCursorFor('org-2', `automation-versions:${NAME}`, '2'),
      mintCursorFor('org-1', `automation-versions:${NAME}`, 'not-a-version'),
    ]) {
      const res = await mount().request(
        url(`/versions?limit=2&cursor=${encodeURIComponent(cursor)}`),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
    const unknown = await mount().request(url('/versions?status=live'));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 'INVALID_QUERY' });
    expect(listVersionHistory).not.toHaveBeenCalled();
  });

  it('answers a missing automation and one the key cannot see as not found', async () => {
    const missing = await mount().request(
      'http://localhost/api/v1/automations/nope/versions',
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      code: 'AUTOMATION_NOT_FOUND',
    });
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    const hidden = await mount().request(url('/versions'));
    expect(hidden.status).toBe(404);
    expect(listVersionHistory).not.toHaveBeenCalled();
  });
});

describe('GET /automations/{name}/deployments', () => {
  const live = {
    version: 3,
    since: 3_500,
    actor: 'api-key:user-ada',
    via: 'mcp' as const,
    clientName: 'Claude Code',
    activeRuns: 1,
  };
  const event = (id: string, at: number, version: number) => ({
    id,
    version,
    previousVersion: version - 1,
    kind: 'deploy' as const,
    synthesized: false,
    at,
    actor: 'api-key:user-ada',
    via: 'mcp' as const,
    apiKeyId: 'key-1',
    clientName: 'Claude Code',
  });

  it('answers what is live and when each version went live, newest first [AUTO-R52]', async () => {
    vi.mocked(listDeploymentEvents).mockResolvedValue({
      live,
      events: [event('e3', 3_500, 3), event('e2', 2_500, 2)],
      nextBefore: null,
    });
    const res = await mount().request(url('/deployments'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: NAME,
      live: {
        version: 3,
        deployedAt: 3_500,
        deployedBy: 'api-key:user-ada',
        deployedByName: 'Ada Lovelace',
        via: 'mcp',
        clientName: 'Claude Code',
        activeRuns: 1,
      },
      deployments: [
        {
          id: 'e3',
          version: 3,
          previousVersion: 2,
          kind: 'deploy',
          synthesized: false,
          deployedAt: 3_500,
          deployedBy: 'api-key:user-ada',
          deployedByName: 'Ada Lovelace',
          via: 'mcp',
          clientName: 'Claude Code',
        },
        {
          id: 'e2',
          version: 2,
          previousVersion: 1,
          kind: 'deploy',
          synthesized: false,
          deployedAt: 2_500,
          deployedBy: 'api-key:user-ada',
          deployedByName: 'Ada Lovelace',
          via: 'mcp',
          clientName: 'Claude Code',
        },
      ],
      isDone: true,
      continueCursor: '',
    });
  });

  it('pages with a signed cursor over the oldest event of the page', async () => {
    vi.mocked(listDeploymentEvents).mockResolvedValueOnce({
      live,
      events: [event('e3', 3_500, 3)],
      nextBefore: { at: 3_500, id: 'e3' },
    });
    const first = await (
      await mount().request(url('/deployments?limit=1'))
    ).json();
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).toBe(
      mintCursorFor('org-1', `automation-deployments:${NAME}`, '3500:e3'),
    );
    expect(listDeploymentEvents).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 1 },
    );
    vi.mocked(listDeploymentEvents).mockResolvedValueOnce({
      live,
      events: [event('e2', 2_500, 2)],
      nextBefore: null,
    });
    await mount().request(
      url(
        `/deployments?limit=1&cursor=${encodeURIComponent(first.continueCursor)}`,
      ),
    );
    expect(listDeploymentEvents).toHaveBeenLastCalledWith(
      expect.anything(),
      'org-1',
      NAME,
      { limit: 1, before: { at: 3_500, id: 'e3' } },
    );
  });

  it('answers nothing live as null, refuses a forged cursor, and hides what the key cannot see', async () => {
    vi.mocked(listDeploymentEvents).mockResolvedValue({
      live: null,
      events: [],
      nextBefore: null,
    });
    expect(
      await (await mount().request(url('/deployments'))).json(),
    ).toMatchObject({ live: null, deployments: [], isDone: true });
    const forged = await mount().request(url('/deployments?cursor=forged'));
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    expect((await mount().request(url('/deployments'))).status).toBe(404);
  });
});

describe('GET /automations/{name}/compare', () => {
  it('compares the latest version with the one saved before it [AUTO-R52]', async () => {
    const res = await mount().request(url('/compare'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: NAME,
      from: 3,
      to: 4,
      first: false,
      identical: false,
      description: { field: 'description', kind: 'changed' },
    });
    // One shape for every door: the shared reader accepts what REST sends.
    expect(versionCompareSchema.safeParse(body).success).toBe(true);
    expect(body).not.toHaveProperty('unified');
  });

  it('reads from and to as numbers or names, and answers a patch in the unified format', async () => {
    const named = await (
      await mount().request(url('/compare?from=deployed&to=latest'))
    ).json();
    expect(named).toMatchObject({ from: 3, to: 4 });
    const numbered = await (
      await mount().request(url('/compare?from=1&to=2&format=unified'))
    ).json();
    expect(numbered).toMatchObject({ from: 1, to: 2 });
    expect(numbered.unified).toEqual(expect.stringContaining('--- v1'));
    expect(numbered.unified).toEqual(expect.stringContaining('+++ v2'));
    expect(numbered).not.toHaveProperty('nodes');
    const both = await (
      await mount().request(url('/compare?format=both'))
    ).json();
    expect(both).toHaveProperty('nodes');
    expect(both).toHaveProperty('unified');
  });

  it('compares the first version with nothing', async () => {
    const body = await (await mount().request(url('/compare?to=1'))).json();
    expect(body).toMatchObject({ from: null, to: 1, first: true });
  });

  it('refuses a version the automation never had, a live version when none is live, and a value it cannot read', async () => {
    const unknown = await mount().request(url('/compare?from=1&to=9'));
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
    engine.deployedVersion.mockResolvedValue(null);
    const none = await mount().request(url('/compare?from=deployed'));
    expect(none.status).toBe(404);
    expect(await none.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
    for (const query of ['from=newest', 'format=html', 'to=previous', 'to=0']) {
      const bad = await mount().request(url(`/compare?${query}`));
      expect(bad.status, query).toBe(400);
      expect(await bad.json(), query).toMatchObject({ code: 'INVALID_QUERY' });
    }
    const extra = await mount().request(url('/compare?nodes=1'));
    expect(extra.status).toBe(400);
  });

  it('answers a missing automation and one the key cannot see as not found', async () => {
    expect(
      (
        await mount().request(
          'http://localhost/api/v1/automations/nope/compare',
        )
      ).status,
    ).toBe(404);
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    expect((await mount().request(url('/compare'))).status).toBe(404);
  });
});

describe('POST /automations/{name}/deployments', () => {
  it('puts a version live naming the one it replaces, and answers what it did with the trigger it starts [AUTO-R53]', async () => {
    engine.deploy.mockResolvedValue({
      name: NAME,
      version: 2,
      previousVersion: 3,
      kind: 'rollback',
      deploymentId: 'event-9',
      trigger: {
        kind: 'schedule',
        enabled: false,
        nextRunAt: null,
        warnings: [
          { level: 'warning', code: 'TRIGGER_OFF', message: 'It is off.' },
        ],
      },
    });
    const res = await post(mount(), '/deployments', {
      version: 2,
      expectedDeployedVersion: 3,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: NAME,
      version: 2,
      previousVersion: 3,
      kind: 'rollback',
      deploymentId: 'event-9',
      trigger: {
        kind: 'schedule',
        enabled: false,
        nextRunAt: null,
        warnings: [{ code: 'TRIGGER_OFF', message: 'It is off.' }],
      },
    });
    expect(engine.deploy).toHaveBeenCalledWith(
      NAME,
      2,
      expect.objectContaining({ expectedDeployedVersion: 3 }),
    );
    // The key's own door: the deploy is recorded as made over REST with it.
    expect(pgAutomationStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        origin: { actor: 'api-key:user-ada', via: 'rest', apiKeyId: 'key-1' },
        visibleOnly: true,
      }),
    );
  });

  it('answers a version that is live already as unchanged, nothing recorded', async () => {
    engine.deploy.mockResolvedValue({
      name: NAME,
      version: 3,
      previousVersion: 3,
      kind: 'unchanged',
      deploymentId: null,
      trigger: null,
    });
    const body = await (
      await post(mount(), '/deployments', { version: 3 })
    ).json();
    expect(body).toMatchObject({
      kind: 'unchanged',
      deploymentId: null,
      trigger: null,
    });
  });

  it('is a developer’s write: a member is refused before anything runs', async () => {
    const res = await post(mount({ role: 'member' }), '/deployments', {
      version: 2,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(engine.deploy).not.toHaveBeenCalled();
  });

  it('refuses a deploy that names a version that is no longer the live one, with the one that is [AUTO-R53]', async () => {
    engine.deploy.mockRejectedValue(
      new AutomationError(
        'AUTOMATION_DEPLOYMENT_STALE',
        'v4 went live meanwhile',
        409,
        { deployedVersion: 4, expectedDeployedVersion: 3 },
      ),
    );
    const res = await post(mount(), '/deployments', {
      version: 2,
      expectedDeployedVersion: 3,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'v4 went live meanwhile',
      code: 'AUTOMATION_DEPLOYMENT_STALE',
      data: { deployedVersion: 4, expectedDeployedVersion: 3 },
    });
  });

  it('refuses a version whose tests fail, with the report, and one that does not validate, with the problems', async () => {
    const failing = await post(mount(), '/deployments', { version: 4 });
    expect(failing.status).toBe(409);
    const refusal = await failing.json();
    expect(refusal).toMatchObject({
      code: 'AUTOMATION_TESTS_FAILING',
      data: { report: { failed: 1 } },
    });
    expect(engine.deploy).not.toHaveBeenCalled();

    engine.get.mockImplementation(async () => ({
      meta: { version: 2 },
      automation: { ...docOf(2), nodes: [{ id: 'x', type: 'nope' }] },
    }));
    const invalid = await post(mount(), '/deployments', { version: 2 });
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({
      code: 'AUTOMATION_INVALID',
      data: { errors: expect.any(Array) },
    });
  });

  it('refuses a body it cannot read, and answers a version the automation never had as not found', async () => {
    for (const body of [
      {},
      { version: 0 },
      { version: '2' },
      { version: 2, extra: true },
      { version: 2, expectedDeployedVersion: 'x' },
    ]) {
      const res = await post(mount(), '/deployments', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    }
    const unknown = await post(mount(), '/deployments', { version: 9 });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
    expect(engine.deploy).not.toHaveBeenCalled();
  });

  it('answers a missing automation and one the key cannot see as not found, deploying nothing', async () => {
    const missing = await mount().request(
      'http://localhost/api/v1/automations/nope/deployments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(missing.status).toBe(404);
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    expect((await post(mount(), '/deployments', { version: 1 })).status).toBe(
      404,
    );
    expect(engine.deploy).not.toHaveBeenCalled();
  });
});

describe('what a write draws from the execute budget', () => {
  it('charges a deploy one execution before anything is looked up, so a missing automation costs it too', async () => {
    const missing = await mount().request(
      'http://localhost/api/v1/automations/nope/deployments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1 }),
      },
    );
    expect(missing.status).toBe(404);
    expect(checkUserRateLimit).toHaveBeenCalledTimes(1);
    expect(checkUserRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      'rest:execute',
      'user-ada',
    );
  });

  it('refuses a deploy once the budget is spent, deploying nothing', async () => {
    vi.mocked(checkUserRateLimit).mockRejectedValueOnce(
      new RateLimitExceededError('over', 1500),
    );
    const res = await post(mount(), '/deployments', { version: 2 });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      code: 'RATE_LIMITED',
      data: { retryAfterMs: 1500 },
    });
    expect(engine.deploy).not.toHaveBeenCalled();
  });

  it('charges nothing for a deploy a role may not make, a body it cannot read, or a restore, which is a save', async () => {
    await post(mount({ role: 'member' }), '/deployments', { version: 2 });
    await post(mount(), '/deployments', { version: 'x' });
    await post(mount(), '/versions/2/restore', {});
    expect(checkUserRateLimit).not.toHaveBeenCalled();
  });
});

describe('POST /automations/{name}/versions/{version}/restore', () => {
  it('saves an older version as the newest and answers its number, what it was restored from and how its tests went [AUTO-R54]', async () => {
    const res = await post(mount(), '/versions/2/restore', {
      message: 'Back to two',
      baseVersion: 4,
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      name: NAME,
      version: 5,
      restoredFrom: 2,
      warnings: [],
    });
    expect(engine.save).toHaveBeenCalledWith(
      docOf(2),
      'Back to two',
      expect.objectContaining({ restoredFrom: 2, baseVersion: 4, name: NAME }),
    );
    expect(pgAutomationStore).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        origin: { actor: 'api-key:user-ada', via: 'rest', apiKeyId: 'key-1' },
        visibleOnly: true,
      }),
    );
    // No body at all is a restore with the defaults.
    engine.save.mockClear();
    const bare = await mount().request(url('/versions/2/restore'), {
      method: 'POST',
    });
    expect(bare.status).toBe(201);
    expect(engine.save).toHaveBeenCalledWith(
      docOf(2),
      'Restore v2',
      expect.anything(),
    );
  });

  it('answers 200 and unchanged when the latest version already holds that content', async () => {
    engine.save.mockResolvedValue({ name: NAME, version: 4, unchanged: true });
    const res = await post(mount(), '/versions/2/restore', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      version: 4,
      restoredFrom: 2,
      unchanged: true,
    });
  });

  it('refuses a restore of a version whose tests fail only by recording it, never deploying', async () => {
    const res = await post(mount(), '/versions/4/restore', {});
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ testsPassed: false });
    expect(engine.deploy).not.toHaveBeenCalled();
  });

  it('is a developer’s write: a member is refused before anything is saved [AUTO-R54]', async () => {
    const res = await post(
      mount({ role: 'member' }),
      '/versions/2/restore',
      {},
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(engine.save).not.toHaveBeenCalled();
  });

  it('keeps the store’s own 409 when a version was saved after the one the restore read, naming the latest', async () => {
    engine.save.mockRejectedValue(
      new AutomationError(
        'AUTOMATION_VERSION_STALE',
        'v5 was saved since',
        409,
        { latestVersion: 5, baseVersion: 4 },
      ),
    );
    const res = await post(mount(), '/versions/2/restore', { baseVersion: 4 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_STALE',
      data: { latestVersion: 5, baseVersion: 4 },
    });
  });

  it('answers a version the automation never had, and one that is not a number, as not found', async () => {
    for (const version of ['9', '0', 'latest', '2x']) {
      const res = await post(mount(), `/versions/${version}/restore`, {});
      expect(res.status, version).toBe(404);
      expect(await res.json(), version).toMatchObject({
        code: 'AUTOMATION_VERSION_UNKNOWN',
      });
    }
    expect(engine.save).not.toHaveBeenCalled();
  });

  it('refuses a body with an unknown key, and answers a hidden automation as not found', async () => {
    const bad = await post(mount(), '/versions/2/restore', { force: true });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'INVALID_BODY' });
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-hidden']);
    expect((await post(mount(), '/versions/2/restore', {})).status).toBe(404);
    expect(engine.save).not.toHaveBeenCalled();
  });
});
