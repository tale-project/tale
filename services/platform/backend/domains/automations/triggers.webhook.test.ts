// @vitest-environment node

import { RETRY_QUEUE_LOCK_CLASS } from '@tale/shared/db/serializable';
import { Hono } from 'hono';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashWebhookToken,
  mintWebhookToken,
} from '../../core/automations/webhook_token.ts';
import { auditChainQueueKey } from '../audit_logs/service.ts';
import type { EventOrigin } from '../events/origin.ts';
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
    /** No `organization` row carries the trigger's org id any more. */
    orgMissing?: boolean;
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
  /** identity_hash → the delivery_keys recorded under it (every scope's row
   * for one delivery), so the cross-scope guard's `identity_hash` lookup can
   * resolve them to their runs through the ledger. */
  const identityToKeys = new Map<string, Set<string>>();
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
  /** The trigger's switch, which the door's disable of an orphan flips. */
  const trigger = { enabled: options.enabled ?? true };
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    if (text.includes('SET enabled = false')) {
      // The conditional disable: still enabled, organization still gone.
      if (!trigger.enabled || options.orgMissing !== true) return [];
      trigger.enabled = false;
      return [{ organizationId: 'org-1', name: 'billing/dunning' }];
    }
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
              enabled: trigger.enabled,
              orgMissing: options.orgMissing ?? false,
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
      const identityHash = String(values[2]);
      const remember = () => {
        const keys = identityToKeys.get(identityHash) ?? new Set<string>();
        keys.add(key);
        identityToKeys.set(identityHash, keys);
      };
      if (options.cachedProjectId !== undefined) {
        // A legacy flat-URL row: no scope-free identity recorded, so it
        // reaches the same-key duplicate path, not the cross-scope guard.
        ledger.set(key, 'cached-run');
        return [];
      }
      if (ledger.has(key)) return [];
      ledger.set(key, null);
      remember();
      return [{ triggerId: 'trigger-1' }];
    }
    // The cross-scope guard's lookup: the live rows sharing this delivery's
    // scope-free identity, as their run ids.
    if (text.includes('identity_hash') && text.startsWith('SELECT run_id AS')) {
      const keys = identityToKeys.get(String(values[1])) ?? new Set<string>();
      return [...keys].map((key) => ({ runId: ledger.get(key) ?? null }));
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
    json: (value: unknown) => value,
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
  return {
    deliver,
    bindings,
    projects,
    ledger,
    runs,
    charges,
    queries,
    trigger,
  };
}

beforeEach(() => vi.clearAllMocks());
// A `console.warn` spy must not outlive a test whose assertion failed.
afterEach(() => vi.restoreAllMocks());

describe('explicit project webhook scope', () => {
  it('uses only the URL project without requiring an API key or session [AUTO-R11]', async () => {
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
    'requires installation in the token target project: %j [AUTO-R7]',
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

  it('refuses archived projects before accepting or replaying deliveries [AUTO-R8]', async () => {
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

  it('keeps header-id retries idempotent within one project and distinct across projects [AUTO-R9]', async () => {
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

  it('matches a delivery id by value, whichever header carried it [AUTO-R9]', async () => {
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
  it('allows an unbound organization automation and replays its org run [AUTO-R9]', async () => {
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

  it('refuses a bound automation through the flat URL with the 409 the REST door answers [AUTO-R7]', async () => {
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

  /**
   * The documented cross-scope guard, end to end (2026-09-18 evaluation,
   * J3-1): a delivery id first taken at a PROJECT door, then re-posted at
   * the ORG door after the automation is uninstalled, answers 409
   * `AUTOMATION_DELIVERY_SCOPE_MISMATCH` — not a second silent run. The
   * project scope's own record stays live, so a re-install and replay there
   * still reads the original run as a duplicate.
   */
  it('refuses the same delivery id across the organization↔project boundary', async () => {
    const { deliver, bindings } = await webhook({ bindings: ['p-1'] });
    const first = await deliver('p-1', { deliveryId: 'evt-cross' });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ runId: 'run-1' });

    // The automation is uninstalled from the project: it is now org-scoped.
    bindings.length = 0;
    const atOrg = await deliver(undefined, { deliveryId: 'evt-cross' });
    expect(atOrg.status).toBe(409);
    expect(await atOrg.json()).toMatchObject({
      code: 'AUTOMATION_DELIVERY_SCOPE_MISMATCH',
    });
    // No second run was started for the org door.
    expect(beginRunInTx).toHaveBeenCalledOnce();

    // Re-installed, the project door still knows the original delivery.
    bindings.push('p-1');
    const replay = await deliver('p-1', { deliveryId: 'evt-cross' });
    expect(await replay.json()).toEqual({ runId: 'run-1', duplicate: true });
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });

  it('lets the same delivery id start one run in each installed project [AUTO-R9]', async () => {
    // Per-project fan-out is not a scope mismatch (webhooks.md): two
    // different projects each get their own run for one id.
    const { deliver, runs } = await webhook();
    const p1 = await deliver('p-1', { deliveryId: 'evt-fan' });
    const p2 = await deliver('p-2', { deliveryId: 'evt-fan' });
    expect(await p1.json()).toEqual({ runId: 'run-1' });
    expect(await p2.json()).toEqual({ runId: 'run-2' });
    expect(runs.get('run-1')?.projectId).toBe('p-1');
    expect(runs.get('run-2')?.projectId).toBe('p-2');
    expect(beginRunInTx).toHaveBeenCalledTimes(2);
  });

  it('preserves token secrecy and body limits [AUTO-R11]', async () => {
    const { deliver } = await webhook({ bindings: [] });
    expect((await deliver(undefined, { unknownToken: true })).status).toBe(404);
    expect(
      (await deliver(undefined, { body: 'x'.repeat(256 * 1024 + 1) })).status,
    ).toBe(413);
    const disabled = await webhook({ enabled: false });
    expect((await disabled.deliver('p-1')).status).toBe(404);
  });

  /**
   * The organization behind a genuine token is gone (a deletion before 0.5.9
   * left the binding behind, or 0125 kept it under a legal hold): whoever
   * still holds the URL starts nothing. The first delivery switches the
   * binding off and names it once; every answer is the 404 a disabled URL
   * gets, so the door says nothing about the organization.
   */
  it.each([undefined, 'p-1'])(
    'starts no run for a trigger whose organization no longer exists, at scope %s, and disables it once',
    async (projectId) => {
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { deliver, ledger, runs, charges, queries, trigger } =
        await webhook({ orgMissing: true });
      const lookup = queries.length;

      const first = await deliver(projectId, { deliveryId: 'evt-1' });
      expect(first.status).toBe(404);
      expect(await first.json()).toEqual({
        error: 'Not found',
        code: 'NOT_FOUND',
      });
      expect(trigger.enabled).toBe(false);
      const retire = queries
        .slice(lookup)
        .find((text) => text.includes('SET enabled = false'));
      // The write re-checks the switch and the organization itself.
      expect(retire).toContain('t.enabled = true');
      expect(retire).toContain(
        'NOT EXISTS ( SELECT 1 FROM "organization" o WHERE o."id" = t.org_id )',
      );
      expect(
        queries.find((text) => text.includes('FROM app.automation_triggers')),
      ).toContain('AS "orgMissing"');

      // A retry now meets a disabled URL: the same 404, no second line.
      const retry = await deliver(projectId, { deliveryId: 'evt-1' });
      expect(retry.status).toBe(404);

      expect(beginRunInTx).not.toHaveBeenCalled();
      expect(runs.size).toBe(0);
      expect(ledger.size).toBe(0);
      // Charged to the sender, never to the dead binding's own budget.
      expect(charges).toEqual([
        'webhook:ip ip:203.0.113.7',
        'webhook:ip ip:203.0.113.7',
      ]);
      expect(
        queries.filter((text) => text.includes('SET enabled = false')),
      ).toHaveLength(1);
      const lines = warn.mock.calls.filter((call) =>
        String(call[0]).includes('whose organization no longer exists'),
      );
      expect(lines).toHaveLength(1);
      expect(String(lines[0]?.[0])).toContain('org-1/billing/dunning');
    },
  );

  it('stamps Cache-Control: no-store on every answer, the 202 and the refusals alike', async () => {
    // The door is mounted outside `/api/v1`, so the REST stamper never saw
    // it: a bad token's 404 and the 413 carried no directive at all, and a
    // caching relay in front of a sender could keep the 404 past the point
    // the token became valid (2026-09-12 round-d evaluation, A4-03).
    const { deliver } = await webhook();
    const accepted = await deliver('p-1');
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get('cache-control')).toBe('no-store');
    const unknown = await deliver(undefined, { unknownToken: true });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('cache-control')).toBe('no-store');
    const large = await deliver(undefined, {
      body: 'x'.repeat(256 * 1024 + 1),
    });
    expect(large.status).toBe(413);
    expect(large.headers.get('cache-control')).toBe('no-store');
  });

  it('does not keep a delivery claim when the automation is not deployed [AUTO-R5]', async () => {
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

  it('forwards a refused input with its problems and keeps no claim [AUTO-R6]', async () => {
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
 * it used to stamp "fired" before asking the store for a run at all. The
 * organization's audit chain is taken before the first stamp: a landing run
 * of the same trigger audits first and writes the trigger row after, and a
 * producer that emits before it audits used to hold the row the landing run
 * waited on while waiting on the chain the landing run held.
 */
describe('dispatchAutomationEvent stamps', () => {
  const PLATFORM: EventOrigin = { kind: 'platform' };
  const eventTx = (
    triggers: {
      id: string;
      organizationId: string;
      name: string;
      orgMissing?: boolean;
    }[] = [{ id: 'trigger-e', organizationId: 'org-1', name: 'crm/welcome' }],
    /** What the conditional disable of orphaned bindings gets back. */
    retired: { organizationId: string; name: string }[] = [],
    /** The run an automation-raised event names, as the loop rule reads
     * it; absent, the run cannot be read. */
    raising?: { name: string; startedBy: string; via: string | null },
    /** The projects the listening automations are installed in. */
    installs: { name: string; projectId: string }[] = [],
  ) => {
    const queries: { text: string; values: unknown[] }[] = [];
    const savepoints = { opened: 0, rolledBack: 0 };
    const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      queries.push({ text, values });
      if (text.includes('SET enabled = false')) return retired;
      if (text.includes('FROM app.automation_triggers')) {
        return triggers.map((trigger) => ({ orgMissing: false, ...trigger }));
      }
      if (text.includes('FROM app.automation_runs')) {
        return raising === undefined ? [] : [raising];
      }
      if (text.includes('FROM app.automation_project_bindings')) {
        return installs;
      }
      return [];
    };
    // A savepoint hands its work the same handle and, when the work
    // rejects, rolls back to it and rethrows — the transaction stays usable.
    const tx = Object.assign(tag, {
      unsafe: (text: string) => text,
      json: (value: unknown) => value,
      savepoint: async (fn: (sp: unknown) => Promise<unknown>) => {
        savepoints.opened += 1;
        try {
          return await fn(tx);
        } catch (error) {
          savepoints.rolledBack += 1;
          throw error;
        }
      },
    });
    return { tx, queries, savepoints };
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
        origin: PLATFORM,
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

  it('records not_deployed instead of a fire when nothing is deployed [AUTO-R5]', async () => {
    const { tx, queries } = eventTx();
    vi.mocked(beginRunInTx).mockResolvedValueOnce(null);
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      { organizationId: 'org-1', event: 'contact.created', origin: PLATFORM },
    );
    expect(outcome).toEqual({ started: [], refused: false });
    const stamps = queries.filter((q) =>
      q.text.startsWith('UPDATE app.automation_triggers'),
    );
    expect(stamps).toHaveLength(1);
    expect(stamps[0]?.text).toContain(
      'SET last_skipped_at_ms = ?, last_skip_reason = ?, last_skip_detail = ?',
    );
    // The detail names the event's moment, the instant it skipped.
    const at = stamps[0]?.values[0];
    expect(stamps[0]?.values).toEqual([
      expect.any(Number),
      'not_deployed',
      JSON.stringify({ reason: 'not_deployed', occurrence: at }),
      'trigger-e',
    ]);
  });

  it('takes the audit chain before the first stamp, once per dispatch', async () => {
    const { tx, queries } = eventTx([
      { id: 'trigger-e', organizationId: 'org-1', name: 'crm/welcome' },
      { id: 'trigger-f', organizationId: 'org-1', name: 'crm/follow-up' },
    ]);
    vi.mocked(beginRunInTx)
      .mockResolvedValueOnce({ runId: 'run-e', version: 3 })
      .mockResolvedValueOnce(null);
    await dispatchAutomationEvent(tx as unknown as TransactionSql, {
      organizationId: 'org-1',
      event: 'contact.created',
      origin: PLATFORM,
    });
    const texts = queries.map((q) => q.text);
    const locks = queries.filter((q) =>
      q.text.includes('pg_advisory_xact_lock'),
    );
    expect(locks).toHaveLength(1);
    expect(locks[0]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      auditChainQueueKey('org-1'),
    ]);
    const lockedAt = texts.findIndex((text) =>
      text.includes('pg_advisory_xact_lock'),
    );
    const firstStamp = texts.findIndex((text) =>
      text.startsWith('UPDATE app.automation_triggers'),
    );
    expect(firstStamp).toBeGreaterThan(-1);
    expect(lockedAt).toBeLessThan(firstStamp);
    expect(
      texts.filter((text) => text.startsWith('UPDATE app.automation_triggers')),
    ).toHaveLength(2);
  });

  it('takes no audit chain when no trigger listens for the event', async () => {
    const { tx, queries } = eventTx([]);
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      { organizationId: 'org-1', event: 'contact.created', origin: PLATFORM },
    );
    expect(outcome).toEqual({ started: [], refused: false });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('FROM app.automation_triggers');
    expect(beginRunInTx).not.toHaveBeenCalled();
  });

  it('starts no run for an event of an organization that no longer exists, and disables its listening triggers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orphans = [
      {
        id: 'trigger-e',
        organizationId: 'org-gone',
        name: 'crm/welcome',
        orgMissing: true,
      },
      {
        id: 'trigger-f',
        organizationId: 'org-gone',
        name: 'crm/follow-up',
        orgMissing: true,
      },
    ];
    const { tx, queries } = eventTx(orphans, [
      { organizationId: 'org-gone', name: 'crm/welcome' },
      { organizationId: 'org-gone', name: 'crm/follow-up' },
    ]);
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-gone',
        event: 'conversation.message_received',
        payload: { conversationId: 'c-1' },
        origin: PLATFORM,
      },
    );

    expect(outcome).toEqual({ started: [], refused: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
    const texts = queries.map((q) => q.text);
    expect(texts[0]).toContain('AS "orgMissing"');
    // Neither a fire nor a skip is stamped: the binding is switched off,
    // after the audit chain like every other write to a trigger here.
    expect(
      texts.filter(
        (text) =>
          text.includes('SET last_fired_at_ms') ||
          text.includes('SET last_skipped_at_ms'),
      ),
    ).toHaveLength(0);
    const retiredAt = texts.findIndex((text) =>
      text.includes('SET enabled = false'),
    );
    const lockedAt = texts.findIndex((text) =>
      text.includes('pg_advisory_xact_lock'),
    );
    expect(lockedAt).toBeGreaterThan(-1);
    expect(retiredAt).toBeGreaterThan(lockedAt);
    const retire = queries[retiredAt];
    expect(retire?.values[0]).toEqual(['trigger-e', 'trigger-f']);
    expect(retire?.text).toContain('t.enabled = true');
    expect(retire?.text).toContain(
      'NOT EXISTS ( SELECT 1 FROM "organization" o WHERE o."id" = t.org_id )',
    );
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[automations] event "conversation.message_received": disabled 2 trigger(s) whose organization no longer exists: org-gone/crm/welcome, org-gone/crm/follow-up',
    ]);
  });

  it('stays silent when another dispatch disabled the orphaned triggers first', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries } = eventTx(
      [
        {
          id: 'trigger-e',
          organizationId: 'org-gone',
          name: 'crm/welcome',
          orgMissing: true,
        },
      ],
      [],
    );
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-gone',
        event: 'contact.created',
        origin: PLATFORM,
      },
    );
    expect(outcome).toEqual({ started: [], refused: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(
      queries.filter((q) => q.text.includes('SET enabled = false')),
    ).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  const fromRun = (runId: string): EventOrigin => ({
    kind: 'automation',
    runId,
  });

  it('starts other automations from an event a schedule-started run raised, never its own [AUTO-R12]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries } = eventTx(
      [
        { id: 'trigger-own', organizationId: 'org-1', name: 'mail/sync' },
        { id: 'trigger-other', organizationId: 'org-1', name: 'mail/triage' },
      ],
      [],
      {
        name: 'mail/sync',
        startedBy: 'trigger:trigger-sched',
        via: 'schedule',
      },
    );
    vi.mocked(beginRunInTx).mockResolvedValueOnce({
      runId: 'run-triage',
      version: 1,
    });
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'conversation.message_received',
        origin: fromRun('run-sync'),
      },
    );
    expect(outcome).toEqual({ started: ['run-triage'], refused: false });
    expect(vi.mocked(beginRunInTx)).toHaveBeenCalledOnce();
    expect(vi.mocked(beginRunInTx)).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ name: 'mail/triage' }),
    );
    // The raising run is read in the producer's transaction, by its id.
    const read = queries.find((q) =>
      q.text.includes('FROM app.automation_runs'),
    );
    expect(read?.values).toEqual(['run-sync', 'org-1']);
    // Its own automation's binding is left as it was: no stamp of either kind.
    expect(
      queries.filter(
        (q) =>
          q.text.startsWith('UPDATE app.automation_triggers') &&
          q.values.includes('trigger-own'),
      ),
    ).toHaveLength(0);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[automations] event "conversation.message_received" raised by run run-sync does not start its own automation mail/sync (loop safety)',
    ]);
  });

  it('starts other automations from an event a person’s run raised [AUTO-R12]', async () => {
    const { tx } = eventTx(
      [{ id: 'trigger-other', organizationId: 'org-1', name: 'crm/welcome' }],
      [],
      // A run started by hand with an event-shaped input is not event-started.
      { name: 'crm/import', startedBy: 'user:u-1', via: 'event' },
    );
    vi.mocked(beginRunInTx).mockResolvedValueOnce({
      runId: 'run-welcome',
      version: 2,
    });
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        origin: fromRun('run-import'),
      },
    );
    expect(outcome).toEqual({ started: ['run-welcome'], refused: false });
  });

  it('starts nothing from an event an event-started run raised [AUTO-R12]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries } = eventTx(
      [{ id: 'trigger-other', organizationId: 'org-1', name: 'crm/welcome' }],
      [],
      { name: 'mail/triage', startedBy: 'trigger:trigger-e', via: 'event' },
    );
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        origin: fromRun('run-triage'),
      },
    );
    expect(outcome).toEqual({ started: [], refused: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
    // Nothing is stamped and no audit chain is taken.
    expect(
      queries.filter(
        (q) =>
          q.text.startsWith('UPDATE') ||
          q.text.includes('pg_advisory_xact_lock'),
      ),
    ).toHaveLength(0);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[automations] event "contact.created" raised by run run-triage (mail/triage), itself started by an event, starts no automation (loop safety)',
    ]);
  });

  it('starts nothing from an event whose raising run cannot be read [AUTO-R12]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx } = eventTx();
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        origin: fromRun('run-gone'),
      },
    );
    expect(outcome).toEqual({ started: [], refused: true });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'raised by run run-gone, which could not be read, starts no automation',
    );
  });

  it('reads no run when no trigger listens for the event', async () => {
    const { tx, queries } = eventTx([]);
    await dispatchAutomationEvent(tx as unknown as TransactionSql, {
      organizationId: 'org-1',
      event: 'contact.created',
      origin: fromRun('run-1'),
    });
    expect(queries).toHaveLength(1);
  });

  // --- project scope and isolation -----------------------------------

  const taskCreated = (projectId: string) => ({
    taskId: 'task-1',
    projectId,
    actorType: 'user',
    actorId: 'u-1',
  });

  it('starts the automations installed in the event’s project or nowhere, in that project [AUTO-R35]', async () => {
    const { tx, queries } = eventTx(
      [
        { id: 't-org', organizationId: 'org-1', name: 'ops/org-wide' },
        { id: 't-billing', organizationId: 'org-1', name: 'ops/billing' },
        { id: 't-sales', organizationId: 'org-1', name: 'ops/sales' },
      ],
      [],
      undefined,
      [
        { name: 'ops/billing', projectId: 'p-billing' },
        { name: 'ops/billing', projectId: 'p-other' },
        { name: 'ops/sales', projectId: 'p-sales' },
      ],
    );
    vi.mocked(beginRunInTx)
      .mockResolvedValueOnce({ runId: 'run-org', version: 1 })
      .mockResolvedValueOnce({ runId: 'run-billing', version: 1 });
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'task.created',
        payload: taskCreated('p-billing'),
        origin: PLATFORM,
      },
    );
    expect(outcome).toEqual({
      started: ['run-org', 'run-billing'],
      refused: false,
    });
    const starts = vi.mocked(beginRunInTx).mock.calls.map(([, call]) => ({
      name: call.name,
      projectId: call.projectId,
    }));
    // Sales is installed elsewhere only: it does not hear a Billing event.
    expect(starts).toEqual([
      { name: 'ops/org-wide', projectId: 'p-billing' },
      { name: 'ops/billing', projectId: 'p-billing' },
    ]);
    // The installations are read once, for every listening automation.
    const reads = queries.filter((q) =>
      q.text.includes('FROM app.automation_project_bindings'),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.values).toEqual([
      'org-1',
      ['ops/org-wide', 'ops/billing', 'ops/sales'],
    ]);
    // Nothing is stamped on the trigger that did not hear the event.
    expect(
      queries.filter(
        (q) =>
          q.text.startsWith('UPDATE app.automation_triggers') &&
          q.values.includes('t-sales'),
      ),
    ).toHaveLength(0);
  });

  it('names a sole installation for an event of no project, and none for several [AUTO-R35]', async () => {
    const { tx } = eventTx(
      [
        { id: 't-one', organizationId: 'org-1', name: 'crm/one' },
        { id: 't-two', organizationId: 'org-1', name: 'crm/two' },
      ],
      [],
      undefined,
      [
        { name: 'crm/one', projectId: 'p-1' },
        { name: 'crm/two', projectId: 'p-1' },
        { name: 'crm/two', projectId: 'p-2' },
      ],
    );
    vi.mocked(beginRunInTx)
      .mockResolvedValueOnce({ runId: 'run-one', version: 1 })
      .mockResolvedValueOnce({ runId: 'run-two', version: 1 });
    await dispatchAutomationEvent(tx as unknown as TransactionSql, {
      organizationId: 'org-1',
      event: 'contact.created',
      payload: { contactId: 'c-1' },
      origin: PLATFORM,
    });
    const calls = vi.mocked(beginRunInTx).mock.calls.map(([, call]) => call);
    expect(calls[0]?.projectId).toBe('p-1');
    expect(calls[1]).not.toHaveProperty('projectId');
  });

  it('stamps start_refused on a trigger whose project is archived, and starts nothing there [AUTO-R8]', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries, savepoints } = eventTx(
      [{ id: 't-billing', organizationId: 'org-1', name: 'ops/billing' }],
      [],
      undefined,
      [{ name: 'ops/billing', projectId: 'p-archived' }],
    );
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError(
        'PROJECT_ARCHIVED',
        'The project is archived — restore it before starting a run in it.',
        403,
      ),
    );
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'comment.created',
        payload: {
          comment: {
            body: 'Hi',
            projectId: 'p-archived',
            taskId: 'task-1',
            mentions: [],
          },
        },
        origin: PLATFORM,
      },
    );
    expect(outcome).toEqual({ started: [], refused: false });
    expect(vi.mocked(beginRunInTx).mock.calls[0]?.[1].projectId).toBe(
      'p-archived',
    );
    expect(savepoints).toEqual({ opened: 1, rolledBack: 1 });
    const stamp = queries.find((q) =>
      q.text.includes('SET last_skipped_at_ms'),
    );
    expect(stamp?.values[1]).toBe('start_refused');
    expect(JSON.parse(String(stamp?.values[2]))).toMatchObject({
      reason: 'start_refused',
      code: 'PROJECT_ARCHIVED',
      version: null,
    });
    expect(stamp?.values[3]).toBe('t-billing');
  });

  it('keeps the other listeners’ runs when one trigger’s start is refused [AUTO-R35]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { tx, queries, savepoints } = eventTx([
      { id: 't-strict', organizationId: 'org-1', name: 'crm/strict' },
      { id: 't-open', organizationId: 'org-1', name: 'crm/open' },
    ]);
    vi.mocked(beginRunInTx)
      .mockRejectedValueOnce(
        new AutomationError(
          'AUTOMATION_INPUT_INVALID',
          'Run input does not match the automation inputs schema: "owner" is required',
          400,
          { issues: [{ path: '', message: 'is required' }], version: 4 },
        ),
      )
      .mockResolvedValueOnce({ runId: 'run-open', version: 2 });
    const outcome = await dispatchAutomationEvent(
      tx as unknown as TransactionSql,
      {
        organizationId: 'org-1',
        event: 'contact.created',
        payload: { contactId: 'c-1' },
        origin: PLATFORM,
      },
    );
    expect(outcome).toEqual({ started: ['run-open'], refused: false });
    expect(savepoints).toEqual({ opened: 2, rolledBack: 1 });
    const stamps = queries.filter((q) =>
      q.text.startsWith('UPDATE app.automation_triggers'),
    );
    expect(stamps.map((q) => q.values.at(-1))).toEqual(['t-strict', 't-open']);
    expect(JSON.parse(String(stamps[0]?.values[2]))).toMatchObject({
      reason: 'start_refused',
      code: 'AUTOMATION_INPUT_INVALID',
      version: 4,
    });
    expect(stamps[1]?.text).toContain('SET last_fired_at_ms');
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      '[automations] event "contact.created": 1 trigger(s) could not start a run: crm/strict (AUTOMATION_INPUT_INVALID)',
    ]);
  });

  it('lets a fault of the database roll the whole dispatch back', async () => {
    const { tx } = eventTx([
      { id: 't-a', organizationId: 'org-1', name: 'crm/a' },
      { id: 't-b', organizationId: 'org-1', name: 'crm/b' },
    ]);
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      Object.assign(new Error('could not serialize access'), {
        code: '40001',
      }),
    );
    await expect(
      dispatchAutomationEvent(tx as unknown as TransactionSql, {
        organizationId: 'org-1',
        event: 'contact.created',
        payload: { contactId: 'c-1' },
        origin: PLATFORM,
      }),
    ).rejects.toThrow('could not serialize access');
    expect(beginRunInTx).toHaveBeenCalledOnce();
  });
});
