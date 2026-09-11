// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AutomationError,
  beginRun,
  bindingProjectIds,
  cancelRun,
  deleteAutomationCascade,
  deleteTrigger,
  deployedVersion,
  getRun,
  listRuns,
  listTriggers,
  listVersions,
  setTrigger,
  versionRow,
} from '../domains/automations/store.ts';
import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

/**
 * The automations door's refusals, as the API reference documents them.
 * The regressions under test:
 *
 * - `POST …/runs` treated a broken JSON body like no body and started a LIVE
 *   run with `{}` as its input; an unknown automation answered 409 "not
 *   deployed"; and naming `version` ran any SAVED version live — the deploy
 *   gate (tests must pass before a version is live-eligible) was bypassable
 *   by every developer key.
 * - `POST /runs/{id}/cancel` answered `{cancelled: false}` for a run that
 *   does not exist — a mistyped id read as "nothing to cancel".
 * - `PUT`/`DELETE …/triggers` bound (and minted a webhook token for) a name
 *   nobody ever saved.
 */

vi.mock('../domains/automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/automations/store.ts')>()),
  beginRun: vi.fn(),
  bindingProjectIds: vi.fn(async () => []),
  cancelRun: vi.fn(),
  deleteAutomationCascade: vi.fn(async () => undefined),
  setTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  deployedVersion: vi.fn(),
  getRun: vi.fn(),
  listTriggers: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  listRuns: vi.fn(async () => []),
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
 * filtered through it. */
const visibleProject = {
  id: 'p-visible',
  organizationId: 'org-1',
  teamId: null,
  sharedWithTeamIds: [],
  archivedAt: null,
};

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.projects')) {
      return Promise.resolve([visibleProject]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

function mount() {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql: fakeSql() }));
  return app;
}

const json = (method: string, body?: string) => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body !== undefined ? { body } : {}),
});

beforeEach(() => {
  vi.mocked(versionRow).mockReset();
  vi.mocked(deployedVersion).mockReset();
  vi.mocked(beginRun).mockReset();
  vi.mocked(cancelRun).mockReset();
  vi.mocked(setTrigger).mockReset();
  vi.mocked(deleteTrigger).mockReset();
  vi.mocked(getRun).mockReset();
  vi.mocked(bindingProjectIds).mockReset();
  vi.mocked(bindingProjectIds).mockResolvedValue([]);
  vi.mocked(deleteAutomationCascade).mockReset();
  vi.mocked(deleteAutomationCascade).mockResolvedValue(undefined);
  vi.mocked(listTriggers).mockClear();
  vi.mocked(listVersions).mockClear();
  vi.mocked(listRuns).mockClear();
  // The saved automation has versions 1 and 2; version 1 is deployed.
  vi.mocked(versionRow).mockImplementation(async (_sql, _org, name, version) =>
    name === SAVED && (version === undefined || version === 1 || version === 2)
      ? row(version ?? 2)
      : null,
  );
  vi.mocked(deployedVersion).mockImplementation(async (_sql, _org, name) =>
    name === SAVED ? 1 : undefined,
  );
  vi.mocked(beginRun).mockResolvedValue({ runId: 'run-1', version: 1 });
  vi.mocked(setTrigger).mockResolvedValue({ token: 'tok' });
  vi.mocked(deleteTrigger).mockResolvedValue(true);
  vi.mocked(cancelRun).mockResolvedValue({ cancelled: false });
});

describe('POST /automations/{name}/runs', () => {
  const start = (name: string, body?: string) =>
    mount().request(
      `http://localhost/api/v1/automations/${name}/runs`,
      json('POST', body),
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
    expect(beginRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ input: {}, mode: 'live' }),
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
});

describe('POST /runs/{runId}/cancel', () => {
  it('answers 404 for a run that is not there, and cancels nothing', async () => {
    vi.mocked(getRun).mockResolvedValue(null);
    const res = await mount().request(
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
    const res = await mount().request(
      'http://localhost/api/v1/runs/run-1/cancel',
      json('POST'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: false });
    expect(cancelRun).toHaveBeenCalledWith(expect.anything(), 'org-1', 'run-1');
  });
});

describe('triggers of an automation nobody saved', () => {
  it('PUT answers 404 and mints no token', async () => {
    const res = await mount().request(
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
    const res = await mount().request(
      'http://localhost/api/v1/automations/no-such-automation/triggers',
      json('DELETE'),
    );
    expect(res.status).toBe(404);
    expect(deleteTrigger).not.toHaveBeenCalled();
  });

  it('keeps the saved automation’s doors: PUT binds, DELETE is idempotent', async () => {
    const put = await mount().request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('PUT', '{"kind": "webhook"}'),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ name: SAVED, token: 'tok' });
    vi.mocked(deleteTrigger).mockResolvedValue(false);
    const del = await mount().request(
      `http://localhost/api/v1/automations/${SAVED}/triggers`,
      json('DELETE'),
    );
    expect(del.status).toBe(204);
  });

  it('PUT refuses an unknown key with INVALID_BODY, naming it', async () => {
    const res = await mount().request(
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
});

/**
 * The read doors answer 404 for a name nobody saved — they used to answer
 * a 200 with an empty list, so a typo read as "no versions, no trigger,
 * no runs". A segment that is not a name at all (`../../models`, five
 * hundred characters) is the same 404, and the path is one segment: a raw
 * `billing/dunning` used to resolve to `billing`.
 */
describe('reads of an automation nobody saved', () => {
  it.each(['versions', 'triggers', 'runs'])(
    'GET …/%s answers 404 and lists nothing',
    async (leaf) => {
      const res = await mount().request(
        `http://localhost/api/v1/automations/no-such-automation/${leaf}`,
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        error: 'Automation not found',
        code: 'AUTOMATION_NOT_FOUND',
      });
      expect(listVersions).not.toHaveBeenCalled();
      expect(listTriggers).not.toHaveBeenCalled();
      expect(listRuns).not.toHaveBeenCalled();
    },
  );

  it.each(['..__..', 'Invoice-Sync', 'a__b__', 'x'.repeat(260)])(
    'answers 404 for the segment %j without a lookup',
    async (segment) => {
      const res = await mount().request(
        `http://localhost/api/v1/automations/${segment}/versions`,
      );
      expect(res.status).toBe(404);
      expect(versionRow).not.toHaveBeenCalled();
    },
  );

  it('no longer resolves a raw slash to the first segment', async () => {
    const res = await mount().request(
      `http://localhost/api/v1/automations/${SAVED}/extra/versions`,
    );
    expect(res.status).toBe(404);
    expect(listVersions).not.toHaveBeenCalled();
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
    const res = await mount().request(
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
    const res = await mount().request(
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
    const res = await mount().request(
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
    const res = await mount().request(
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
    const res = await mount().request(
      `http://localhost/api/v1/automations/${SAVED}`,
      json('DELETE'),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'AUTOMATION_HAS_ACTIVE_RUNS',
    });
  });
});
