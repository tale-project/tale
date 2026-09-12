// @vitest-environment node

import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { AutomationError, beginRunInTx } from './store.ts';
import { createWebhookRoutes, dispatchAutomationEvent } from './triggers.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  beginRunInTx: vi.fn(),
}));

/** The one refusal every project-scope problem answers — it names neither
 * the automation nor which of unknown / unbound / archived applied. */
const PROJECT_FORBIDDEN = {
  error: 'The automation cannot run in that project.',
  code: 'AUTOMATION_PROJECT_FORBIDDEN',
};

async function webhook(
  options: {
    bindings?: string[];
    archived?: boolean;
    enabled?: boolean;
    cachedProjectId?: string | null;
    undeployed?: boolean;
    /** The rate-limit rule whose budget is spent. */
    spent?: 'webhook:ip' | 'webhook:trigger';
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
  /** Every rate-limit charge, as `<rule> <key>`, in order. */
  const charges: string[] = [];
  const queries: string[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('INSERT INTO app.rate_limits')) {
      charges.push(`${String(values[0])} ${String(values[1])}`);
      return options.spent === values[0] ? [] : [{ value: '1' }];
    }
    if (text.includes('FROM app.rate_limits')) {
      return [{ value: '0', ts: String(Date.now()) }];
    }
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
  // The deployment's proxy list, as the mount injects it: the loopback hop
  // the test client stands in for is trusted, so the forwarded chain names
  // the sender.
  const deps = { sql, trustedProxies: () => Promise.resolve(['loopback']) };
  const app = new Hono();
  app.route('/api/automations/webhook', createWebhookRoutes(deps));
  app.route('/api/projects/:id/automations/webhook', createWebhookRoutes(deps));
  const deliver = (
    projectId?: string,
    requestOptions: {
      query?: string;
      deliveryId?: string;
      body?: string;
      unknownToken?: boolean;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.request(
      `${projectId === undefined ? '/api/automations/webhook' : `/api/projects/${projectId}/automations/webhook`}/${requestOptions.unknownToken ? 'unknown-token' : token}${requestOptions.query ?? ''}`,
      {
        method: 'POST',
        body: requestOptions.body ?? '{}',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '203.0.113.7',
          ...(requestOptions.deliveryId
            ? { 'idempotency-key': requestOptions.deliveryId }
            : {}),
          ...requestOptions.headers,
        },
      },
    );
  return { deliver, bindings, projects, ledger, runs, charges, queries };
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

  /**
   * A caller holding only a URL learns nothing about the organization's
   * projects: a project that does not exist, one in another organization,
   * one the automation is not installed in and an archived one all get the
   * SAME 403, whose sentence names neither the automation (its slug used to
   * ride in the "not bound" message) nor which case applied.
   */
  it.each(['missing', 'foreign'])(
    'refuses project %s with the one uninformative 403, before claiming a delivery',
    async (projectId) => {
      const { deliver, ledger } = await webhook();
      const response = await deliver(projectId);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(PROJECT_FORBIDDEN);
      expect(ledger.size).toBe(0);
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it.each([[], ['p-2']])(
    'requires installation in the token target project: %j',
    async (...bindings) => {
      const { deliver, ledger } = await webhook({ bindings });
      const response = await deliver('p-1');
      expect(response.status).toBe(403);
      const body = await response.text();
      expect(JSON.parse(body)).toEqual(PROJECT_FORBIDDEN);
      expect(body).not.toContain('billing/dunning');
      expect(ledger.size).toBe(0);
      expect(beginRunInTx).not.toHaveBeenCalled();
    },
  );

  it('refuses archived projects before accepting or replaying deliveries', async () => {
    const { deliver, projects } = await webhook();
    expect((await deliver('p-1')).status).toBe(202);
    const project = projects.get('p-1');
    if (project) project.archivedAt = 1;
    const response = await deliver('p-1');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(PROJECT_FORBIDDEN);
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });

  it('rechecks installation even for a cached delivery', async () => {
    const { deliver, bindings } = await webhook();
    expect((await deliver('p-1')).status).toBe(202);
    bindings.splice(0, 1);
    expect((await deliver('p-1')).status).toBe(403);
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

  it('matches a delivery id by value, whichever header carried it', async () => {
    // A gateway that re-stamps a vendor's id under a canonical header name
    // is the same delivery, not a second one.
    const { deliver } = await webhook();
    const first = await deliver('p-1', {
      headers: { 'x-github-delivery': 'gh-77' },
    });
    const restamped = await deliver('p-1', { deliveryId: 'gh-77' });
    expect(await first.json()).toEqual({ runId: 'run-1' });
    expect(await restamped.json()).toEqual({ runId: 'run-1', duplicate: true });
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });

  it('does not return a cached run belonging to a different project', async () => {
    const { deliver } = await webhook({ cachedProjectId: 'p-2' });
    const response = await deliver('p-1');
    // The delivery was recorded in another scope: a 409 with its own code,
    // never the run it names.
    expect(response.status).toBe(409);
    const body = await response.text();
    expect(body).not.toContain('cached-run');
    expect(JSON.parse(body)).toMatchObject({
      code: 'AUTOMATION_DELIVERY_SCOPE_MISMATCH',
    });
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

  it('refuses a bound automation through the flat URL with the 409 the REST door answers', async () => {
    const { deliver } = await webhook({ bindings: ['p-1'] });
    const response = await deliver();
    // The same refusal used to be a 409 on the key door and a flat 400
    // here, so a client had to branch on the URL instead of the code.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'AUTOMATION_PROJECT_SCOPE_REQUIRED',
    });
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('does not leak an old flat delivery ledger entry that points to a project run', async () => {
    const { deliver } = await webhook({ bindings: [], cachedProjectId: 'p-1' });
    const response = await deliver();
    expect(response.status).toBe(409);
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
    const { deliver, ledger, queries } = await webhook({
      bindings: [],
      undeployed: true,
    });
    expect((await deliver()).status).toBe(409);
    expect(ledger.size).toBe(0);
    // The delivery's transaction rolled back; the skip is recorded on its
    // own, so the trigger read shows the URL was hit and why nothing ran.
    const skip = queries.find((text) =>
      text.includes('SET last_skipped_at_ms'),
    );
    expect(skip).toContain('last_skip_reason = ?');
    expect(queries.some((text) => text.includes('SET last_fired_at_ms'))).toBe(
      false,
    );
  });

  it('stamps the fire and the run it started together, and nothing on a replay', async () => {
    const { deliver, queries } = await webhook({ bindings: [] });
    expect((await deliver(undefined, { deliveryId: 'd-1' })).status).toBe(202);
    const stamps = queries.filter((text) =>
      text.includes('SET last_fired_at_ms'),
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toContain('last_run_id = ?');
    expect((await deliver(undefined, { deliveryId: 'd-1' })).status).toBe(202);
    expect(
      queries.filter((text) => text.includes('SET last_fired_at_ms')),
    ).toHaveLength(1);
  });

  it('forwards a refused input with its problems and keeps no claim', async () => {
    const { deliver, ledger } = await webhook({ bindings: [] });
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_INPUT_INVALID',
        'Run input does not match the automation inputs schema: "payload.orderId" is required',
        400,
        { issues: [{ path: 'payload.orderId', message: 'is required' }] },
      ),
    );
    const response = await deliver();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error:
        'Run input does not match the automation inputs schema: "payload.orderId" is required',
      code: 'AUTOMATION_INPUT_INVALID',
      data: { issues: [{ path: 'payload.orderId', message: 'is required' }] },
    });
    expect(ledger.size).toBe(0);
  });
});

/**
 * Nothing authenticates a sender, so the door budgets twice: the sender's
 * IP (derived through the trusted-proxy list the mount injects) before the
 * token is hashed or looked up, and the verified trigger after — so a
 * leaked URL starts a bounded number of runs a minute, and a flood of
 * plausible tokens costs the door one charge each and nothing more.
 */
describe('webhook door budgets', () => {
  it('charges the sender before the token is looked up, and the trigger once verified', async () => {
    const { deliver, charges } = await webhook({ bindings: [] });
    expect((await deliver()).status).toBe(202);
    expect(charges).toEqual([
      'webhook:ip ip:203.0.113.7',
      'webhook:trigger trigger:trigger-1',
    ]);
    // An unknown (but plausible) token is charged to the sender and never
    // to a trigger — there is none.
    charges.length = 0;
    expect((await deliver(undefined, { unknownToken: true })).status).toBe(404);
    expect(charges).toEqual(['webhook:ip ip:203.0.113.7']);
  });

  it('answers 429 with Retry-After when the sender budget is spent, before reading the body or the token', async () => {
    const { deliver, queries } = await webhook({
      bindings: [],
      spent: 'webhook:ip',
    });
    const response = await deliver(undefined, { body: '{"attempt":1}' });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(await response.json()).toMatchObject({ code: 'RATE_LIMITED' });
    expect(
      queries.some((text) => text.includes('FROM app.automation_triggers')),
    ).toBe(false);
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('answers 429 when the trigger budget is spent, before claiming a delivery', async () => {
    const { deliver, ledger } = await webhook({
      bindings: [],
      spent: 'webhook:trigger',
    });
    const response = await deliver();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(ledger.size).toBe(0);
    expect(beginRunInTx).not.toHaveBeenCalled();
  });
});

/**
 * The event path is the schedule's twin inside the producer's transaction:
 * the fire stamp and the run it names land only when a run was inserted,
 * and a binding whose automation has nothing deployed records the skip —
 * it used to stamp "fired" before asking the store for a run at all.
 */
describe('dispatchAutomationEvent stamps', () => {
  const eventTx = () => {
    const queries: { text: string; values: unknown[] }[] = [];
    const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values });
      if (text.includes('FROM app.automation_triggers')) {
        return [
          { id: 'trigger-e', organizationId: 'org-1', name: 'crm/welcome' },
        ];
      }
      return [];
    };
    return {
      tx: Object.assign(tag, { unsafe: (text: string) => text }),
      queries,
    };
  };

  it('stamps the fire with the run id when a run started', async () => {
    const { tx, queries } = eventTx();
    vi.mocked(beginRunInTx).mockResolvedValueOnce({
      runId: 'run-e',
      version: 3,
    });
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        payload: { id: 'c-1' },
        origin: 'platform',
      },
    );
    expect(outcome).toEqual({ started: ['run-e'], refused: false });
    const stamps = queries.filter((q) =>
      q.text.startsWith('UPDATE app.automation_triggers'),
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.text).toContain(
      'SET last_fired_at_ms = ?, last_run_id = ?',
    );
    expect(stamps[0]?.values).toEqual([
      expect.any(Number),
      'run-e',
      'trigger-e',
    ]);
    // The stamp follows the run insert, never precedes it.
    expect(vi.mocked(beginRunInTx)).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        name: 'crm/welcome',
        startedBy: 'trigger:trigger-e',
        input: {
          trigger: 'event',
          event: 'contact.created',
          payload: { id: 'c-1' },
        },
      }),
    );
  });

  it('records not_deployed instead of a fire when nothing is deployed', async () => {
    const { tx, queries } = eventTx();
    vi.mocked(beginRunInTx).mockResolvedValueOnce(null);
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      { organizationId: 'org-1', event: 'contact.created', origin: 'platform' },
    );
    expect(outcome).toEqual({ started: [], refused: false });
    const stamps = queries.filter((q) =>
      q.text.startsWith('UPDATE app.automation_triggers'),
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.text).toContain(
      'SET last_skipped_at_ms = ?, last_skip_reason = ?',
    );
    expect(stamps[0]?.values).toEqual([
      expect.any(Number),
      'not_deployed',
      'trigger-e',
    ]);
  });

  it('fires nothing and stamps nothing for an event an automation raised', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries } = eventTx();
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        origin: 'automation',
      },
    );
    expect(outcome).toEqual({ started: [], refused: true });
    expect(queries).toHaveLength(0);
    expect(beginRunInTx).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
