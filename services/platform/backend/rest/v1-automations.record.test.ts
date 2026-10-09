/**
 * The REST doors onto a run's record. Each reads the run as `GET …/runs/
 * {runId}` does: on the global path a run outside every project, on a
 * project's path that project's run — anything else is the 404 a missing
 * run gets. A query is refused as the house refuses one; a page's cursor is
 * signed for its run and step, so one forged or carried over is refused.
 */

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

const store = vi.hoisted(() => ({ getRun: vi.fn() }));
const record = vi.hoisted(() => ({
  readRunRecord: vi.fn(),
  readNodeDetail: vi.fn(),
  readNodePage: vi.fn(),
  readRunComparison: vi.fn(),
}));

vi.mock('../domains/automations/store.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../domains/automations/store.ts')>()),
  getRun: store.getRun,
}));
vi.mock('../domains/automations/run-record.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../domains/automations/run-record.ts')
  >()),
  ...record,
}));

const project = {
  id: 'p-2',
  organizationId: 'org-1',
  name: 'Ledger',
  teamId: null,
  sharedWithTeamIds: [],
  archivedAt: null,
};

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([project]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    return Promise.resolve([]);
  };
  const begin = (
    options: string | ((tx: unknown) => Promise<unknown>),
    callback?: (tx: unknown) => Promise<unknown>,
  ) => (typeof options === 'function' ? options(sql) : callback?.(sql));
  const sql = Object.assign(tag, { unsafe: (text: string) => text, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return sql as unknown as Sql;
}

function request(path: string): Promise<Response> {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'worker@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'member');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/api/v1', createAutomationRestRoutes({ sql: fakeSql() }));
  return Promise.resolve(app.request(`http://localhost/api/v1${path}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.getRun.mockImplementation(
    async (_sql: unknown, _org: string, id: string) => {
      if (id === 'org-run') return { id, projectId: null };
      if (id === 'project-run') return { id, projectId: 'p-2' };
      return null;
    },
  );
  record.readRunRecord.mockResolvedValue({ format: 1, nodes: [] });
  record.readNodeDetail.mockResolvedValue({ path: 'fetch' });
  record.readNodePage.mockResolvedValue({
    path: 'each',
    units: [{ item: 0 }],
    next: '0:-1',
  });
  record.readRunComparison.mockResolvedValue({ nodes: [] });
});

describe('GET …/runs/{runId}/record', () => {
  it('reads an organization run on the global path, a project run on its project’s', async () => {
    expect((await request('/runs/org-run/record')).status).toBe(200);
    expect(
      (await request('/projects/p-2/runs/project-run/record')).status,
    ).toBe(200);
    expect(record.readRunRecord).toHaveBeenCalledTimes(2);
  });

  it('answers a run outside the URL’s scope like a missing one', async () => {
    for (const path of [
      '/runs/project-run/record',
      '/projects/p-2/runs/org-run/record',
      '/runs/nope/record',
    ]) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
    }
    expect(record.readRunRecord).not.toHaveBeenCalled();
  });

  it('reads a delta and travels, and refuses what it does not take', async () => {
    await request('/runs/org-run/record?since=1700000000000&include=travels');
    expect(record.readRunRecord).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'org-run',
      since: 1_700_000_000_000,
      travels: true,
    });
    for (const query of ['since=soon', 'include=values', 'detail=1']) {
      const res = await request(`/runs/org-run/record?${query}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_QUERY' });
    }
  });
});

describe('GET …/runs/{runId}/record/node', () => {
  it('reads one unit, and names one the record does not hold', async () => {
    const res = await request('/runs/org-run/record/node?node=each&item=2');
    expect(res.status).toBe(200);
    expect(record.readNodeDetail).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'org-run',
      path: 'each',
      item: 2,
    });
    record.readNodeDetail.mockResolvedValue(null);
    const missing = await request('/runs/org-run/record/node?node=ghost');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'NODE_RUN_NOT_FOUND' });
  });

  it('needs a step, and an item or pass from -1', async () => {
    expect((await request('/runs/org-run/record/node')).status).toBe(400);
    expect(
      (await request('/runs/org-run/record/node?node=a&pass=-2')).status,
    ).toBe(400);
  });
});

describe('GET …/runs/{runId}/record/items', () => {
  it('answers the house keyset page, its cursor good for the next page only', async () => {
    const first = await request('/runs/org-run/record/items?node=each&limit=1');
    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      units: unknown[];
      isDone: boolean;
      continueCursor: string;
    };
    expect(page).toMatchObject({ path: 'each', isDone: false });
    expect(page.continueCursor).not.toBe('');
    const cursor = encodeURIComponent(page.continueCursor);
    const next = await request(
      `/runs/org-run/record/items?node=each&cursor=${cursor}`,
    );
    expect(next.status).toBe(200);
    expect(record.readNodePage).toHaveBeenLastCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'org-run',
      path: 'each',
      cursor: '0:-1',
      limit: 50,
    });
    // Signed for this run's step: another step, or a forged token, is not a
    // place in this list.
    for (const query of [
      `node=other&cursor=${cursor}`,
      'node=each&cursor=0:-1',
    ]) {
      const res = await request(`/runs/org-run/record/items?${query}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
  });

  it('keeps failed units only when asked, and refuses a limit that is not a number', async () => {
    await request('/runs/org-run/record/items?node=each&status=failed');
    expect(record.readNodePage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'failed' }),
    );
    const res = await request('/runs/org-run/record/items?node=each&limit=x');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_LIMIT' });
  });
});

describe('GET …/runs/{runId}/compare/{otherRunId}', () => {
  it('compares two runs readable on the same path', async () => {
    expect((await request('/runs/org-run/compare/org-run')).status).toBe(200);
    const res = await request('/runs/org-run/compare/project-run');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'RUN_NOT_FOUND' });
  });

  it('keeps the refusal of two different automations’ runs', async () => {
    const { AutomationError } = await import('../domains/automations/store.ts');
    record.readRunComparison.mockRejectedValue(
      new AutomationError('RUN_COMPARE_MISMATCH', 'different', 400),
    );
    const res = await request('/runs/org-run/compare/org-run');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'RUN_COMPARE_MISMATCH' });
  });
});
