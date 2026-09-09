// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginRun,
  cancelRun,
  deleteTrigger,
  deployedVersion,
  getRun,
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
  cancelRun: vi.fn(),
  setTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  deployedVersion: vi.fn(),
  getRun: vi.fn(),
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

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
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
    expect(await res.json()).toEqual({ error: 'invalid body' });
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
    expect(await res.json()).toEqual({ error: 'Automation not found' });
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
    expect(await res.json()).toEqual({ error: 'Run not found' });
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it('keeps {cancelled:false} for a run that exists but already finished', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only existence matters to the route
    vi.mocked(getRun).mockResolvedValue({ id: 'run-1' } as never);
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
    expect(await res.json()).toEqual({ error: 'Automation not found' });
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
});
