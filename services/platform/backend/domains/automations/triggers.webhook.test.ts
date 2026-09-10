// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { beginRunInTx } from './store.ts';
import { createWebhookRoutes } from './triggers.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  beginRunInTx: vi.fn(),
}));

async function webhook(
  options: {
    bindings?: string[];
    archived?: boolean;
    enabled?: boolean;
    cachedProjectId?: string | null;
    undeployed?: boolean;
  } = {},
) {
  const token = mintWebhookToken();
  const tokenHash = await hashWebhookToken(token);
  const bindings = [...(options.bindings ?? ['p-1', 'p-2'])];
  const projects = new Map([
    [
      'p-1',
      {
        id: 'p-1',
        organizationId: 'org-1',
        archivedAt: options.archived ? 1 : null,
      },
    ],
    ['p-2', { id: 'p-2', organizationId: 'org-1', archivedAt: null }],
    ['foreign', { id: 'foreign', organizationId: 'org-2', archivedAt: null }],
  ]);
  const ledger = new Map<string, string | null>();
  const runs = new Map<
    string,
    { id: string; organizationId: string; projectId: string | null }
  >();
  if (options.cachedProjectId !== undefined)
    runs.set('cached-run', {
      id: 'cached-run',
      organizationId: 'org-1',
      projectId: options.cachedProjectId,
    });
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.automation_triggers')) {
      return values.includes(tokenHash)
        ? [
            {
              id: 'trigger-1',
              organizationId: 'org-1',
              name: 'billing/dunning',
              tokenHash,
              enabled: options.enabled ?? true,
            },
          ]
        : [];
    }
    if (text.includes('FROM app.automation_project_bindings'))
      return bindings.map((projectId) => ({ projectId }));
    if (text.includes('FROM app.projects')) {
      const id = String(text.includes('WHERE org_id') ? values[1] : values[0]);
      const project = projects.get(id);
      return project === undefined ||
        (text.includes('WHERE org_id') && project.organizationId !== values[0])
        ? []
        : [project];
    }
    if (text.startsWith('INSERT INTO app.automation_webhook_deliveries')) {
      const key = String(values[1]);
      if (options.cachedProjectId !== undefined) {
        ledger.set(key, 'cached-run');
        return [];
      }
      if (ledger.has(key)) return [];
      ledger.set(key, null);
      return [{ triggerId: 'trigger-1' }];
    }
    if (text.startsWith('SELECT run_id AS'))
      return [{ runId: ledger.get(String(values[1])) ?? null }];
    if (text.includes('FROM app.automation_runs')) {
      const row = runs.get(String(values[1]));
      return row === undefined ? [] : [row];
    }
    if (text.startsWith('UPDATE app.automation_webhook_deliveries'))
      ledger.set(String(values[2]), String(values[0]));
    return [];
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: async (
      transactionOptions: string | ((tx: unknown) => Promise<unknown>),
      callback?: (tx: unknown) => Promise<unknown>,
    ) => {
      const before = new Map(ledger);
      try {
        return await (typeof transactionOptions === 'function'
          ? transactionOptions(sql)
          : callback?.(sql));
      } catch (error) {
        ledger.clear();
        for (const [key, value] of before) ledger.set(key, value);
        throw error;
      }
    },
  }) as unknown as Sql;
  vi.mocked(beginRunInTx).mockImplementation(async (_tx, args) => {
    if (options.undeployed) return null;
    const runId = `run-${runs.size + 1}`;
    runs.set(runId, {
      id: runId,
      organizationId: 'org-1',
      projectId: args.projectId ?? null,
    });
    return { runId, version: 1 };
  });
  const app = new Hono();
  app.route('/api/automations/webhook', createWebhookRoutes({ sql }));
  app.route(
    '/api/projects/:id/automations/webhook',
    createWebhookRoutes({ sql }),
  );
  const deliver = (
    projectId?: string,
    requestOptions: {
      query?: string;
      deliveryId?: string;
      body?: string;
      unknownToken?: boolean;
    } = {},
  ) =>
    app.request(
      `${projectId === undefined ? '/api/automations/webhook' : `/api/projects/${projectId}/automations/webhook`}/${requestOptions.unknownToken ? 'unknown-token' : token}${requestOptions.query ?? ''}`,
      {
        method: 'POST',
        body: requestOptions.body ?? '{}',
        headers: {
          'content-type': 'application/json',
          ...(requestOptions.deliveryId
            ? { 'idempotency-key': requestOptions.deliveryId }
            : {}),
        },
      },
    );
  return { deliver, bindings, projects, ledger, runs };
}

beforeEach(() => vi.clearAllMocks());

describe('explicit project webhook scope', () => {
  it('uses only the URL project without requiring an API key or session', async () => {
    const { deliver, runs } = await webhook();
    const response = await deliver('p-1', {
      body: '{"projectId":"event-data"}',
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: 'run-1' });
    expect(runs.get('run-1')?.projectId).toBe('p-1');
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectId: 'p-1',
        input: { trigger: 'webhook', payload: { projectId: 'event-data' } },
      }),
    );
  });

  it.each([undefined, 'p-1'])(
    'rejects query projectId on scope %s',
    async (projectId) => {
      const { deliver } = await webhook({ bindings: [] });
      for (const query of ['?projectId=p-1', '?projectId=']) {
        expect((await deliver(projectId, { query })).status).toBe(400);
      }
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'foreign'])(
    'refuses project %s before claiming a delivery',
    async (projectId) => {
      const { deliver, ledger } = await webhook();
      expect((await deliver(projectId)).status).toBe(400);
      expect(ledger.size).toBe(0);
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it.each([[], ['p-2']])(
    'requires installation in the token target project: %j',
    async (...bindings) => {
      const { deliver, ledger } = await webhook({ bindings });
      expect((await deliver('p-1')).status).toBe(400);
      expect(ledger.size).toBe(0);
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it('refuses archived projects before accepting or replaying deliveries', async () => {
    const { deliver, projects } = await webhook();
    expect((await deliver('p-1')).status).toBe(202);
    const project = projects.get('p-1');
    if (project) project.archivedAt = 1;
    expect((await deliver('p-1')).status).toBe(400);
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });

  it('rechecks installation even for a cached delivery', async () => {
    const { deliver, bindings } = await webhook();
    expect((await deliver('p-1')).status).toBe(202);
    bindings.splice(0, 1);
    expect((await deliver('p-1')).status).toBe(400);
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });

  it('keeps header-id retries idempotent within one project and distinct across projects', async () => {
    const { deliver, runs } = await webhook();
    const first = await deliver('p-1', { deliveryId: 'same-vendor-id' });
    const second = await deliver('p-2', { deliveryId: 'same-vendor-id' });
    const retry = await deliver('p-1', { deliveryId: 'same-vendor-id' });
    expect(await first.json()).toEqual({ runId: 'run-1' });
    expect(await second.json()).toEqual({ runId: 'run-2' });
    expect(await retry.json()).toEqual({ runId: 'run-1', duplicate: true });
    expect(runs.get('run-1')?.projectId).toBe('p-1');
    expect(runs.get('run-2')?.projectId).toBe('p-2');
    expect(beginRunInTx).toHaveBeenCalledTimes(2);
  });

  it('does not return a cached run belonging to a different project', async () => {
    const { deliver } = await webhook({ cachedProjectId: 'p-2' });
    const response = await deliver('p-1');
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('cached-run');
  });
});

describe('organization webhook scope and delivery contract', () => {
  it('allows an unbound organization automation and replays its org run', async () => {
    const { deliver, runs } = await webhook({ bindings: [] });
    expect((await deliver()).status).toBe(202);
    expect(runs.get('run-1')?.projectId).toBeNull();
    expect(await (await deliver()).json()).toEqual({
      runId: 'run-1',
      duplicate: true,
    });
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireOrgScope: true }),
    );
  });

  it('refuses a bound automation through the flat URL instead of inferring a project', async () => {
    const { deliver } = await webhook({ bindings: ['p-1'] });
    expect((await deliver()).status).toBe(400);
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('does not leak an old flat delivery ledger entry that points to a project run', async () => {
    const { deliver } = await webhook({ bindings: [], cachedProjectId: 'p-1' });
    const response = await deliver();
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('cached-run');
  });

  it('preserves token secrecy and body limits', async () => {
    const { deliver } = await webhook({ bindings: [] });
    expect((await deliver(undefined, { unknownToken: true })).status).toBe(404);
    expect(
      (await deliver(undefined, { body: 'x'.repeat(256 * 1024 + 1) })).status,
    ).toBe(413);
    const disabled = await webhook({ enabled: false });
    expect((await disabled.deliver('p-1')).status).toBe(404);
  });

  it('does not keep a delivery claim when the automation is not deployed', async () => {
    const { deliver, ledger } = await webhook({
      bindings: [],
      undeployed: true,
    });
    expect((await deliver()).status).toBe(409);
    expect(ledger.size).toBe(0);
  });
});
