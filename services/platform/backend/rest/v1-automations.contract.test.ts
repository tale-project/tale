// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomationError,
  automationExists,
  beginRun,
  beginRunIdempotent,
  beginRunIdempotentInTx,
  beginRunInTx,
  bindingProjectIds,
  cancelRun,
  deleteAutomationCascade,
  deleteRunInTx,
  deleteTrigger,
  deployedVersion,
  getRun,
  listRunsPage,
  listTriggers,
  listVersions,
  setTrigger,
  versionRow,
} from '../domains/automations/store.ts';
import { formatKeysetCursor, mintCursorFor, type RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

/**
 * The automations door's refusals, as the API reference documents them.
 * The regressions under test:
 *
 * - `POST …/runs` treated a broken JSON body like no body and started a LIVE
 *   run with `{}` as its input; an unknown automation answered 409 "not
 *   deployed"; and naming `version` ran any SAVED version live — the deploy
 *   gate (tests must pass before a version is live-eligible) was bypassable
 *   by every developer key. It silently discarded `Idempotency-Key`.
 * - `POST /runs/{id}/cancel` answered `{cancelled: false}` for a run that
 *   does not exist — a mistyped id read as "nothing to cancel".
 * - `PUT`/`DELETE …/triggers` bound (and minted a webhook token for) a name
 *   nobody ever saved.
 * - `GET /automations/{name}?version=N` answered "automation not found" for
 *   a version that was never saved, and `%2F` was an undocumented alias
 *   of the `__` spelling.
 * - Run listings inlined every run's input, output, trace and checkpoints,
 *   took no status filter and no cursor, and no listing crossed automations.
 */

vi.mock('../domains/automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/automations/store.ts')>()),
  automationExists: vi.fn(),
  beginRun: vi.fn(),
  beginRunIdempotent: vi.fn(),
  beginRunIdempotentInTx: vi.fn(),
  beginRunInTx: vi.fn(),
  bindingProjectIds: vi.fn(async () => []),
  cancelRun: vi.fn(),
  deleteAutomationCascade: vi.fn(async () => undefined),
  deleteRunInTx: vi.fn(),
  setTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  deployedVersion: vi.fn(),
  getRun: vi.fn(),
  listTriggers: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  listRunsPage: vi.fn(),
  versionRow: vi.fn(),
}));

const SAVED = 'invoice-sync';
const row = (version: number) => ({
  name: SAVED,
  version,
  document: {},
  message: null,
  testsPassed: null,
  taskContract: null,
  settings: null,
  presentation: null,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
});

/** The one project the key holder can see — every binding listing is
 * filtered through it, and the project routes resolve it. */
const visibleProject = {
  id: 'p-visible',
  organizationId: 'org-1',
  teamId: null,
  sharedWithTeamIds: [],
  archivedAt: null,
};

const runRow = {
  id: 'run-1',
  organizationId: 'org-1',
  name: SAVED,
  version: 1,
  projectId: null,
  status: 'success',
  mode: 'live' as const,
  startedBy: 'api-key:user-1',
  input: { n: 1 },
  output: 2,
  checkpoints: { nodes: {}, executions: 1 },
  trace: [{ node: 'shape' }],
  effects: [],
  detail: null,
  claimEpoch: 1,
  chainSeq: 0,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_000_500,
};

/** What a listing answers for `runRow`: identity, scope, status, timing. */
const runSummary = {
  runId: 'run-1',
  name: SAVED,
  version: 1,
  projectId: null,
  status: 'success',
  mode: 'live',
  startedBy: 'api-key:user-1',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_000_500,
};

function fakeSql(): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([visibleProject]);
    }
    return Promise.resolve([]);
  };
  const begin = (
    options: string | ((tx: unknown) => Promise<unknown>),
    callback?: (tx: unknown) => Promise<unknown>,
  ) => (typeof options === 'function' ? options(sql) : callback?.(sql));
  const sql = Object.assign(tag, { unsafe: (t: string) => t, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(options: { role?: string } = {}) {
  const { sql, queries } = fakeSql();
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', options.role ?? 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql }));
  return { app, queries };
}

const json = (
  method: string,
  body?: string,
  headers: Record<string, string> = {},
) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  ...(body !== undefined ? { body } : {}),
});

beforeEach(() => {
  vi.mocked(automationExists).mockReset();
  vi.mocked(versionRow).mockReset();
  vi.mocked(deployedVersion).mockReset();
  vi.mocked(beginRun).mockReset();
  vi.mocked(beginRunIdempotent).mockReset();
  vi.mocked(beginRunIdempotentInTx).mockReset();
  vi.mocked(beginRunInTx).mockReset();
  vi.mocked(cancelRun).mockReset();
  vi.mocked(deleteRunInTx).mockReset();
  vi.mocked(setTrigger).mockReset();
  vi.mocked(deleteTrigger).mockReset();
  vi.mocked(getRun).mockReset();
  vi.mocked(bindingProjectIds).mockReset();
  vi.mocked(bindingProjectIds).mockResolvedValue([]);
  vi.mocked(deleteAutomationCascade).mockReset();
  vi.mocked(deleteAutomationCascade).mockResolvedValue(undefined);
  vi.mocked(listTriggers).mockClear();
  vi.mocked(listVersions).mockReset();
  vi.mocked(listVersions).mockResolvedValue([]);
  vi.mocked(listRunsPage).mockReset();
  vi.mocked(listRunsPage).mockResolvedValue({
    runs: [],
    isDone: true,
    next: null,
  });
  // The saved automation has versions 1 and 2; version 1 is deployed.
  vi.mocked(automationExists).mockImplementation(
    async (_sql, _org, name) => name === SAVED,
  );
  vi.mocked(versionRow).mockImplementation(async (_sql, _org, name, version) =>
    name === SAVED && (version === undefined || version === 1 || version === 2)
      ? row(version ?? 2)
      : null,
  );
  vi.mocked(deployedVersion).mockImplementation(async (_sql, _org, name) =>
    name === SAVED ? 1 : undefined,
  );
  vi.mocked(beginRun).mockResolvedValue({ runId: 'run-1', version: 1 });
  vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'run-1', version: 1 });
  vi.mocked(beginRunIdempotent).mockResolvedValue({
    runId: 'run-1',
    version: 1,
    duplicate: false,
  });
  vi.mocked(beginRunIdempotentInTx).mockResolvedValue({
    runId: 'run-1',
    version: 1,
    duplicate: false,
  });
  vi.mocked(deleteRunInTx).mockResolvedValue({ deleted: true });
  vi.mocked(setTrigger).mockResolvedValue({ token: 'tok' });
  vi.mocked(deleteTrigger).mockResolvedValue(true);
  vi.mocked(cancelRun).mockResolvedValue({ cancelled: false });
});

describe('POST /automations/{name}/runs', () => {
  const start = (
    name: string,
    body?: string,
    headers?: Record<string, string>,
  ) =>
    mount().app.request(
      `http://localhost/api/v1/automations/${name}/runs`,
      json('POST', body, headers),
    );

  it('answers 400 for a body that is present but not JSON, and starts nothing', async () => {
    const res = await start(SAVED, '{"mode": "live", broken');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid body: The body is not valid JSON',
      code: 'INVALID_BODY',
    });
    expect(beginRun).not.toHaveBeenCalled();
  });

  it('still reads no body as an empty input', async () => {
    const res = await start(SAVED);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      runId: 'run-1',
      version: 1,
      name: SAVED,
      mode: 'live',
    });
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: {}, mode: 'live' }),
    );
  });

  it('hands a null input on as null, for the inputs schema to judge', async () => {
    // `null` used to be silently read as `{}` and run against a schema
    // that would have refused it.
    const res = await start(SAVED, '{"input": null}');
    expect(res.status).toBe(202);
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: null }),
    );
  });

  it('answers 404 for a name nobody saved', async () => {
    const res = await start('no-such-automation', '{"mode": "mock"}');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Automation not found',
      code: 'AUTOMATION_NOT_FOUND',
    });
    expect(beginRun).not.toHaveBeenCalled();
  });

  it('answers 404 for a version the automation does not have', async () => {
    const res = await start(SAVED, '{"mode": "mock", "version": 9}');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
    expect(beginRun).not.toHaveBeenCalled();
  });

  it('refuses a LIVE run of a saved version that is not the deployed one', async () => {
    const res = await start(SAVED, '{"version": 2}');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
    });
    expect(beginRun).not.toHaveBeenCalled();
  });

  it('lets a LIVE run name the deployed version explicitly', async () => {
    const res = await start(SAVED, '{"version": 1}');
    expect(res.status).toBe(202);
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 1, mode: 'live' }),
    );
  });

  it('lets a MOCK run name any saved version — the builder’s test lane', async () => {
    const res = await start(SAVED, '{"mode": "mock", "version": 2}');
    expect(res.status).toBe(202);
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ version: 2, mode: 'mock' }),
    );
  });

  it('refuses a live start by a role without the developer capability before charging the lane', async () => {
    const { app, queries } = mount({ role: 'member' });
    const res = await app.request(
      `http://localhost/api/v1/automations/${SAVED}/runs`,
      json('POST', '{}'),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(queries.some((q) => q.includes('INSERT INTO app.rate_limits'))).toBe(
      false,
    );
    expect(beginRun).not.toHaveBeenCalled();
  });
});

/**
 * `Idempotency-Key` names a start: a repeat within a day answers the run
 * the first attempt started, flagged `duplicate: true`; a repeat with
 * another body is the store's 409; a blank header is no key at all.
 */
describe('Idempotency-Key on a run start', () => {
  const start = (
    headers: Record<string, string>,
    body = '{"input": {"n": 1}}',
  ) =>
    mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/runs`,
      json('POST', body, headers),
    );

  it('starts through the idempotent door and answers the identity', async () => {
    const res = await start({ 'Idempotency-Key': ' order-42 ' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      runId: 'run-1',
      version: 1,
      name: SAVED,
      mode: 'live',
    });
    expect(beginRunIdempotent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: SAVED,
        input: { n: 1 },
        mode: 'live',
        requireOrgScope: true,
      }),
      { key: 'order-42' },
    );
    expect(beginRun).not.toHaveBeenCalled();
  });

  it('answers the remembered run with duplicate: true', async () => {
    vi.mocked(beginRunIdempotent).mockResolvedValue({
      runId: 'run-first',
      version: 1,
      duplicate: true,
    });
    const res = await start({ 'Idempotency-Key': 'order-42' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      runId: 'run-first',
      version: 1,
      name: SAVED,
      mode: 'live',
      duplicate: true,
    });
  });

  it('passes the reuse refusal through as its 409', async () => {
    vi.mocked(beginRunIdempotent).mockRejectedValue(
      new AutomationError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request.',
        409,
      ),
    );
    const res = await start({ 'Idempotency-Key': 'order-42' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This Idempotency-Key was already used for a different request.',
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it('reads a blank header as no key', async () => {
    const res = await start({ 'Idempotency-Key': '   ' });
    expect(res.status).toBe(202);
    expect(beginRun).toHaveBeenCalled();
    expect(beginRunIdempotent).not.toHaveBeenCalled();
  });

  it('claims the key inside the project authorization transaction', async () => {
    const res = await mount().app.request(
      `http://localhost/api/v1/projects/p-visible/automations/${SAVED}/runs`,
      json('POST', '{"mode": "mock"}', { 'Idempotency-Key': 'order-42' }),
    );
    expect(res.status).toBe(202);
    expect(beginRunIdempotentInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: 'p-visible', mode: 'mock' }),
      { key: 'order-42' },
    );
    expect(beginRunInTx).not.toHaveBeenCalled();
  });
});

describe('POST /runs/{runId}/cancel', () => {
  it('answers 404 for a run that is not there, and cancels nothing', async () => {
    vi.mocked(getRun).mockResolvedValue(null);
    const res = await mount().app.request(
      'http://localhost/api/v1/runs/run-nope/cancel',
      json('POST'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Run not found',
      code: 'RUN_NOT_FOUND',
    });
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('keeps {cancelled:false} for a run that exists but already finished', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the global route needs an existing org-scoped run
    vi.mocked(getRun).mockResolvedValue({
      id: 'run-1',
      projectId: null,
    } as never);
    const res = await mount().app.request(
      'http://localhost/api/v1/runs/run-1/cancel',
      json('POST'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: false });
    expect(cancelRun).toHaveBeenCalledWith(expect.anything(), 'org-1', 'run-1');
  });
});

/**
 * A finished run can be removed through the door that created it — the
 * stop route's scope and capability rules, 204 on success, the same 404 for
 * a run that is not there or not in this scope, the store's 409 in flight.
 */
describe('DELETE /runs/{runId}', () => {
  it('removes a finished organization run and answers 204', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: null });
    const res = await mount().app.request(
      'http://localhost/api/v1/runs/run-1',
      json('DELETE'),
    );
    expect(res.status).toBe(204);
    expect(deleteRunInTx).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-1',
      actor: 'user-1',
    });
  });

  it('answers 404 for a run that is not there or belongs to a project', async () => {
    vi.mocked(getRun).mockResolvedValueOnce(null);
    expect(
      (
        await mount().app.request(
          'http://localhost/api/v1/runs/run-nope',
          json('DELETE'),
        )
      ).status,
    ).toBe(404);
    vi.mocked(getRun).mockResolvedValueOnce({ ...runRow, projectId: 'p-1' });
    const res = await mount().app.request(
      'http://localhost/api/v1/runs/run-1',
      json('DELETE'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Run not found',
      code: 'RUN_NOT_FOUND',
    });
    expect(deleteRunInTx).not.toHaveBeenCalled();
  });

  it('passes the in-flight refusal through as 409', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, status: 'running' });
    vi.mocked(deleteRunInTx).mockRejectedValue(
      new AutomationError('RUN_ACTIVE', 'The run is still running.', 409),
    );
    const res = await mount().app.request(
      'http://localhost/api/v1/runs/run-1',
      json('DELETE'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'The run is still running.',
      code: 'RUN_ACTIVE',
    });
  });

  it('needs the developer capability', async () => {
    const res = await mount({ role: 'member' }).app.request(
      'http://localhost/api/v1/runs/run-1',
      json('DELETE'),
    );
    expect(res.status).toBe(403);
    expect(deleteRunInTx).not.toHaveBeenCalled();
  });

  it('removes a project run at its project URL', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: 'p-visible' });
    const res = await mount().app.request(
      'http://localhost/api/v1/projects/p-visible/runs/run-1',
      json('DELETE'),
    );
    expect(res.status).toBe(204);
    expect(deleteRunInTx).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-1',
      actor: 'user-1',
    });
  });
});

describe('triggers of an automation nobody saved', () => {
  it('PUT answers 404 and mints no token', async () => {
    const res = await mount().app.request(
      'http://localhost/api/v1/automations/no-such-automation/triggers',
      json('PUT', '{"kind": "webhook"}'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Automation not found',
      code: 'AUTOMATION_NOT_FOUND',
    });
    expect(setTrigger).not.toHaveBeenCalled();
  });

  it('DELETE answers 404 instead of the idempotent 204', async () => {
    const res = await mount().app.request(
      'http://localhost/api/v1/automations/no-such-automation/triggers',
      json('DELETE'),
    );
    expect(res.status).toBe(404);
    expect(deleteTrigger).not.toHaveBeenCalled();
  });

  it('keeps the saved automation’s doors: PUT binds, DELETE is idempotent', async () => {
    const put = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('PUT', '{"kind": "webhook"}'),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ name: SAVED, token: 'tok' });
    vi.mocked(deleteTrigger).mockResolvedValue(false);
    const del = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('DELETE'),
    );
    expect(del.status).toBe(204);
  });

  it('PUT refuses an unknown key with INVALID_BODY, naming it', async () => {
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('PUT', '{"kind": "webhook", "rotate_token": true}'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      data: { issues: [{ path: 'rotate_token' }] },
    });
    expect(setTrigger).not.toHaveBeenCalled();
  });

  it('PUT names a missing kind as required, not as a wrong option', async () => {
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('PUT', '{"cron": "* * * * *"}'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid body: "kind" is required',
      code: 'INVALID_BODY',
      data: { issues: [{ path: 'kind', message: 'is required' }] },
    });
  });

  it('PUT passes the store’s refusal of an event nobody raises through', async () => {
    vi.mocked(setTrigger).mockRejectedValue(
      new AutomationError(
        'AUTOMATION_TRIGGER_INVALID',
        '"tale.eval.no.such.event" is not an event the platform raises — one of contact.created.',
      ),
    );
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('PUT', '{"kind": "event", "event": "tale.eval.no.such.event"}'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
    });
  });
});

/**
 * The read doors answer 404 for a name nobody saved — they used to answer
 * a 200 with an empty list, so a typo read as "no versions, no trigger,
 * no runs". A segment that is not a name at all (`../../models`, five
 * hundred characters) is the same 404, and the path is one segment: a raw
 * `billing/dunning` used to resolve to `billing`, and a `%2F` worked as an
 * undocumented alias of `__`.
 */
describe('reads of an automation nobody saved', () => {
  it.each(['versions', 'triggers', 'runs'])(
    'GET …/%s answers 404 and lists nothing',
    async (leaf) => {
      const res = await mount().app.request(
        `http://localhost/api/v1/automations/no-such-automation/${leaf}`,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'Automation not found',
        code: 'AUTOMATION_NOT_FOUND',
      });
      expect(listVersions).not.toHaveBeenCalled();
      expect(listTriggers).not.toHaveBeenCalled();
      expect(listRunsPage).not.toHaveBeenCalled();
    },
  );

  it.each([
    '..__..',
    'Invoice-Sync',
    'a__b__',
    'x'.repeat(260),
    'invoice%2Fsync',
  ])('answers 404 for the segment %j without a lookup', async (segment) => {
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${segment}/versions`,
    );
    expect(res.status).toBe(404);
    expect(automationExists).not.toHaveBeenCalled();
    expect(versionRow).not.toHaveBeenCalled();
  });

  it('no longer resolves a raw slash to the first segment', async () => {
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/extra/versions`,
    );
    expect(res.status).toBe(404);
    expect(listVersions).not.toHaveBeenCalled();
  });
});

/**
 * The bare read answers the latest SAVED version; `?version=deployed` the
 * one a live run executes; a number a specific one. A version that is not
 * there is its own 404 when the automation is, so a version-pinning client
 * can tell "never saved" from "deleted".
 */
describe('GET /automations/{name}', () => {
  const read = (query = '') =>
    mount().app.request(`http://localhost/api/v1/automations/${SAVED}${query}`);

  it('answers the latest saved version by default', async () => {
    const res = await read();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: SAVED,
      version: 2,
      deployedVersion: 1,
    });
  });

  it.each(['?version=latest', '?version=2'])(
    'answers the latest version for %s',
    async (query) => {
      expect(await (await read(query)).json()).toMatchObject({ version: 2 });
    },
  );

  it('answers the deployed version for ?version=deployed', async () => {
    const res = await read('?version=deployed');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 1, deployedVersion: 1 });
  });

  it('answers 404 AUTOMATION_VERSION_UNKNOWN for ?version=deployed with nothing deployed', async () => {
    vi.mocked(deployedVersion).mockResolvedValue(undefined);
    const res = await read('?version=deployed');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('nothing is deployed'),
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
  });

  it('answers 404 AUTOMATION_VERSION_UNKNOWN for a version never saved', async () => {
    const res = await read('?version=9');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: `"${SAVED}" has no version 9.`,
      code: 'AUTOMATION_VERSION_UNKNOWN',
    });
  });

  it('keeps AUTOMATION_NOT_FOUND for a version of an automation nobody saved', async () => {
    const res = await mount().app.request(
      'http://localhost/api/v1/automations/no-such-automation?version=9',
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'AUTOMATION_NOT_FOUND' });
  });

  it.each(['?version=0', '?version=abc', '?version=1.5'])(
    'refuses %s as INVALID_QUERY',
    async (query) => {
      const res = await read(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'INVALID_QUERY',
        data: { issues: [{ path: 'version' }] },
      });
    },
  );
});

describe('GET /automations/{name}/versions', () => {
  it('marks the deployed version', async () => {
    vi.mocked(listVersions).mockResolvedValue([
      {
        version: 2,
        message: 'second',
        testsPassed: null,
        createdBy: 'user-1',
        createdAt: 2,
      },
      {
        version: 1,
        message: null,
        testsPassed: true,
        createdBy: 'user-1',
        createdAt: 1,
      },
    ]);
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/versions`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: SAVED,
      deployedVersion: 1,
      versions: [
        {
          version: 2,
          message: 'second',
          testsPassed: null,
          createdBy: 'user-1',
          createdAt: 2,
          deployed: false,
        },
        {
          version: 1,
          message: null,
          testsPassed: true,
          createdBy: 'user-1',
          createdAt: 1,
          deployed: true,
        },
      ],
    });
  });

  it('answers null when nothing is deployed', async () => {
    vi.mocked(deployedVersion).mockResolvedValue(undefined);
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/versions`,
    );
    expect(await res.json()).toMatchObject({ deployedVersion: null });
  });
});

/**
 * Run listings answer SUMMARIES — identity, scope, status, timing — as a
 * keyset page: `{runs, isDone, continueCursor}`, with `?status=` to filter
 * and `?include=` for the full-row fields a summary omits. The cursor is
 * signed for the listing that answered it.
 */
describe('run listings', () => {
  const page = {
    runs: [runRow],
    isDone: false,
    next: { at: 1_700_000_000_000, id: 'run-1' },
  };
  const list = (path: string) =>
    mount().app.request(`http://localhost/api/v1${path}`);

  it('answers summaries and a cursor for the older runs', async () => {
    vi.mocked(listRunsPage).mockResolvedValue(page);
    const res = await list(`/automations/${SAVED}/runs`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      runs: [runSummary],
      isDone: false,
      continueCursor: mintCursorFor(
        'org-1',
        `runs:org:${SAVED}`,
        formatKeysetCursor(1_700_000_000_000, 'run-1'),
      ),
    });
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      name: SAVED,
      projectId: null,
      limit: 50,
    });
  });

  it('answers an empty continueCursor on the last page', async () => {
    vi.mocked(listRunsPage).mockResolvedValue({
      runs: [runRow],
      isDone: true,
      next: null,
    });
    expect(
      await (await list(`/automations/${SAVED}/runs`)).json(),
    ).toMatchObject({ isDone: true, continueCursor: '' });
  });

  it('inlines exactly the full-row fields ?include= names', async () => {
    vi.mocked(listRunsPage).mockResolvedValue(page);
    const res = await list(`/automations/${SAVED}/runs?include=input,output`);
    expect(res.status).toBe(200);
    expect((await res.json()).runs).toEqual([
      { ...runSummary, input: { n: 1 }, output: 2 },
    ]);
  });

  it('passes the status set on and refuses one it does not know', async () => {
    const res = await list(`/automations/${SAVED}/runs?status=failed,success`);
    expect(res.status).toBe(200);
    expect(listRunsPage).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      expect.objectContaining({ statuses: ['failed', 'success'] }),
    );
    const refused = await list(`/automations/${SAVED}/runs?status=bogus`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'status' }] },
    });
    const included = await list(
      `/automations/${SAVED}/runs?include=trace,bogus`,
    );
    expect(included.status).toBe(400);
    expect(await included.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'include' }] },
    });
  });

  it('walks from the cursor it answered, and refuses another list’s', async () => {
    const position = formatKeysetCursor(1_700_000_000_000, 'run-1');
    const own = mintCursorFor('org-1', `runs:org:${SAVED}`, position);
    const res = await list(`/automations/${SAVED}/runs?cursor=${own}`);
    expect(res.status).toBe(200);
    expect(listRunsPage).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      expect.objectContaining({
        before: { at: 1_700_000_000_000, id: 'run-1' },
      }),
    );
    const foreign = mintCursorFor('org-1', 'runs:all', position);
    const refused = await list(`/automations/${SAVED}/runs?cursor=${foreign}`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('refuses a limit that is not a whole number', async () => {
    const res = await list(`/automations/${SAVED}/runs?limit=abc`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });

  it('GET /runs answers every run the key holder can see, whatever started it', async () => {
    vi.mocked(listRunsPage).mockResolvedValue(page);
    const res = await list('/runs?status=failed');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runs: [runSummary] });
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      visibleProjectIds: ['p-visible'],
      statuses: ['failed'],
      limit: 50,
    });
  });

  it('GET /projects/{id}/runs answers the project’s runs', async () => {
    const res = await list('/projects/p-visible/runs');
    expect(res.status).toBe(200);
    expect(listRunsPage).toHaveBeenCalledWith(expect.anything(), 'org-1', {
      projectId: 'p-visible',
      limit: 50,
    });
  });

  /**
   * `?include=` is bounded by the API, never by the caller's data: a page
   * ends at the last row that fits the byte budget and its cursor points
   * there, so the walk stays complete — one such page used to move 5.5 MB
   * inside a single request budget, and the ceiling was `limit × the
   * largest input in the organization`.
   */
  describe('the inline byte budget', () => {
    const heavy = (id: string, mb: number) => ({
      ...runRow,
      id,
      startedAt: 1_700_000_000_000 - Number(id.slice(4)) * 1000,
      input: 'x'.repeat(mb * 1024 * 1024),
    });

    it('ends an inlining page at the last row that fits and points the cursor there', async () => {
      vi.mocked(listRunsPage).mockResolvedValue({
        runs: [heavy('run-1', 3), heavy('run-2', 3), heavy('run-3', 3)],
        isDone: true,
        next: null,
      });
      const res = await list(`/automations/${SAVED}/runs?include=input`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.runs.map((run: { runId: string }) => run.runId)).toEqual([
        'run-1',
        'run-2',
      ]);
      expect(body.isDone).toBe(false);
      expect(body.continueCursor).toBe(
        mintCursorFor(
          'org-1',
          `runs:org:${SAVED}`,
          formatKeysetCursor(1_700_000_000_000 - 2000, 'run-2'),
        ),
      );
    });

    it('still answers a single row above the budget, as a page of one', async () => {
      vi.mocked(listRunsPage).mockResolvedValue({
        runs: [heavy('run-1', 9), heavy('run-2', 1)],
        isDone: true,
        next: null,
      });
      const body = await (
        await list(`/automations/${SAVED}/runs?include=input`)
      ).json();
      expect(body.runs.map((run: { runId: string }) => run.runId)).toEqual([
        'run-1',
      ]);
      expect(body.isDone).toBe(false);
    });

    it('replaces the store’s own cursor with the cut row’s', async () => {
      vi.mocked(listRunsPage).mockResolvedValue({
        runs: [heavy('run-1', 5), heavy('run-2', 5), heavy('run-3', 1)],
        isDone: false,
        next: { at: 1_700_000_000_000 - 3000, id: 'run-3' },
      });
      const body = await (
        await list(`/automations/${SAVED}/runs?include=input`)
      ).json();
      expect(body.runs.map((run: { runId: string }) => run.runId)).toEqual([
        'run-1',
      ]);
      expect(body.continueCursor).toBe(
        mintCursorFor(
          'org-1',
          `runs:org:${SAVED}`,
          formatKeysetCursor(1_700_000_000_000 - 1000, 'run-1'),
        ),
      );
    });

    it('reads at most 25 rows when it inlines, whatever limit asked', async () => {
      vi.mocked(listRunsPage).mockResolvedValue({
        runs: [runRow],
        isDone: true,
        next: null,
      });
      await list(`/automations/${SAVED}/runs?include=output&limit=200`);
      expect(listRunsPage).toHaveBeenLastCalledWith(
        expect.anything(),
        'org-1',
        expect.objectContaining({ limit: 25 }),
      );
      await list(`/automations/${SAVED}/runs?limit=200`);
      expect(listRunsPage).toHaveBeenLastCalledWith(
        expect.anything(),
        'org-1',
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('never cuts a summary page — nothing heavy is inlined', async () => {
      vi.mocked(listRunsPage).mockResolvedValue({
        runs: [heavy('run-1', 9), heavy('run-2', 9), heavy('run-3', 9)],
        isDone: true,
        next: null,
      });
      const body = await (await list(`/automations/${SAVED}/runs`)).json();
      expect(body.runs).toHaveLength(3);
      expect(body.isDone).toBe(true);
      expect(body.continueCursor).toBe('');
    });
  });
});

/**
 * A run read answers the whole row — input, output, trace, checkpoints —
 * and a poller after `status` moved all of it on every read (one run here
 * weighed 4 MB to convey nine bytes). `?fields=` names the keys to keep.
 */
describe('GET /runs/{runId} with ?fields=', () => {
  const read = (path: string) =>
    mount().app.request(`http://localhost/api/v1${path}`);

  it('answers only the keys named, in the run’s own order', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: null });
    const res = await read('/runs/run-1?fields=finishedAt,status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'success',
      finishedAt: 1_700_000_000_500,
    });
  });

  it('answers the same projection on the project URL', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: 'p-visible' });
    const res = await read('/projects/p-visible/runs/run-1?fields=status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
  });

  it('answers the whole run when no fields are named', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: null });
    expect(await (await read('/runs/run-1')).json()).toEqual(runRow);
  });

  it('refuses a key the run does not have, naming it', async () => {
    vi.mocked(getRun).mockResolvedValue({ ...runRow, projectId: null });
    const res = await read('/runs/run-1?fields=status,bogus');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [{ path: 'fields' }] },
    });
    expect(getRun).not.toHaveBeenCalled();
  });

  it('refuses a blank member, so a trailing comma is not a silent no-op', async () => {
    const res = await read('/runs/run-1?fields=status,');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('still refuses a query parameter the read does not take', async () => {
    const res = await read('/runs/run-1?include=input');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });
});

/**
 * A project-bound automation refused at the organization URL names its
 * precondition: the projects it is installed in that the caller can see —
 * the scope to start it in — so recovery is in the answer, not only in
 * the product UI. The read and the catalog carry the same ids.
 */
describe('project bindings on the wire', () => {
  it('answers the org-URL 409 with the visible installations', async () => {
    vi.mocked(beginRun).mockRejectedValue(
      new AutomationError(
        'AUTOMATION_PROJECT_SCOPE_REQUIRED',
        'A project-bound automation requires an explicit project scope.',
        409,
      ),
    );
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-visible', 'p-hidden']);
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}/runs`,
      json('POST', '{"mode": "mock"}'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'A project-bound automation requires an explicit project scope.',
      code: 'AUTOMATION_PROJECT_SCOPE_REQUIRED',
      data: { projectIds: ['p-visible'] },
    });
  });

  it('carries the visible installations and a null deployedVersion on the read', async () => {
    vi.mocked(bindingProjectIds).mockResolvedValue(['p-visible', 'p-hidden']);
    vi.mocked(deployedVersion).mockResolvedValue(undefined);
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      name: SAVED,
      deployedVersion: null,
      projectIds: ['p-visible'],
    });
  });
});

/**
 * The API is no longer write-only for automations: a developer can retire
 * one (versions, trigger and installations go; run history stays) and
 * uninstall one from a project.
 */
describe('DELETE /automations/{name}', () => {
  it('retires a saved automation and answers 204', async () => {
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}`,
      json('DELETE'),
    );
    expect(res.status).toBe(204);
    expect(deleteAutomationCascade).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      name: SAVED,
      actor: 'user-1',
    });
  });

  it('answers 404 for a name nobody saved and deletes nothing', async () => {
    const res = await mount().app.request(
      'http://localhost/api/v1/automations/no-such-automation',
      json('DELETE'),
    );
    expect(res.status).toBe(404);
    expect(deleteAutomationCascade).not.toHaveBeenCalled();
  });

  it('passes the in-flight-run refusal through with its code', async () => {
    vi.mocked(deleteAutomationCascade).mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_HAS_ACTIVE_RUNS',
        'A run is still in flight.',
        409,
      ),
    );
    const res = await mount().app.request(
      `http://localhost/api/v1/automations/${SAVED}`,
      json('DELETE'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_HAS_ACTIVE_RUNS',
    });
  });
});
