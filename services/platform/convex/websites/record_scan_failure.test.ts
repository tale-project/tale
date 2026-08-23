import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';
import { CONNECTION_FAILURES_BEFORE_PAUSE } from './scan_scheduling';

// convex-test module map, keyed relative to the convex/ root. This file lives at
// convex/websites/, so the glob reaches the root via ../ and keys are normalized
// back to convex-root-relative paths.
const TEST_DIR_FROM_CONVEX_ROOT = 'websites';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_scanfail';
const DOMAIN = 'demo.example.com';

async function provision(t: ReturnType<typeof convexTest>) {
  return await t.mutation(
    internal.websites.internal_mutations.provisionWebsite,
    {
      organizationId: ORG,
      domain: DOMAIN,
      scanInterval: '6h',
      status: 'scanning',
      metadata: { workflowId: 'wf_1' },
    },
  );
}

function recordFailure(
  t: ReturnType<typeof convexTest>,
  corpusUnreachable: boolean,
) {
  return t.mutation(internal.websites.internal_mutations.recordScanFailure, {
    organizationId: ORG,
    domain: DOMAIN,
    message: "password authentication failed for user 'neondb_owner'",
    corpusUnreachable,
  });
}

describe('recordScanFailure', () => {
  it('records a connection failure on the Convex row — the only reachable store', async () => {
    const t = convexTest(schema, modules);
    const websiteId = await provision(t);

    const { paused } = await recordFailure(t, true);

    expect(paused).toBe(false);
    await t.run(async (ctx) => {
      const website = await ctx.db.get(websiteId);
      expect(website?.status).toBe('error');
      expect(website?.metadata?.lastSyncError).toContain(
        'password authentication failed',
      );
      expect(website?.metadata?.corpusConnectionFailures).toBe(1);
      expect(typeof website?.metadata?.lastScanAttemptAt).toBe('number');
      // The pre-existing metadata survives the merge.
      expect(website?.metadata?.workflowId).toBe('wf_1');
      // Below the threshold nothing pauses and no one is notified.
      expect(website?.metadata?.scanPausedAt ?? null).toBeNull();
      expect(await ctx.db.query('notifications').collect()).toHaveLength(0);
    });
  });

  it('pauses at the threshold and notifies org admins exactly once', async () => {
    const t = convexTest(schema, modules);
    const websiteId = await provision(t);

    for (let i = 0; i < CONNECTION_FAILURES_BEFORE_PAUSE - 1; i++) {
      const { paused } = await recordFailure(t, true);
      expect(paused).toBe(false);
    }
    const { paused } = await recordFailure(t, true);
    expect(paused).toBe(true);

    // A further failure from an already-queued scan neither re-pauses nor
    // re-notifies — one incident, one notification.
    const again = await recordFailure(t, true);
    expect(again.paused).toBe(false);

    await t.run(async (ctx) => {
      const website = await ctx.db.get(websiteId);
      expect(typeof website?.metadata?.scanPausedAt).toBe('number');
      const notifications = await ctx.db.query('notifications').collect();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        organizationId: ORG,
        category: 'security',
        severity: 'warning',
        titleKey: 'websiteScanPaused',
        bodyKey: 'websiteScanPausedDetails',
        params: { domain: DOMAIN, failures: CONNECTION_FAILURES_BEFORE_PAUSE },
      });
    });
  });

  it('a reachable-but-failed scan resets the connection streak', async () => {
    // The streak means "the database configuration is broken"; a scan the
    // database answered proves it is not, whatever else went wrong.
    const t = convexTest(schema, modules);
    const websiteId = await provision(t);

    await recordFailure(t, true);
    await recordFailure(t, true);
    const { paused } = await recordFailure(t, false);

    expect(paused).toBe(false);
    await t.run(async (ctx) => {
      const website = await ctx.db.get(websiteId);
      expect(website?.metadata?.corpusConnectionFailures ?? null).toBeNull();
      // The attempt still counts toward the retry backoff.
      expect(typeof website?.metadata?.lastScanAttemptAt).toBe('number');
    });
  });

  it('is a no-op for a domain the organization does not track', async () => {
    const t = convexTest(schema, modules);
    const { paused } = await recordFailure(t, true);
    expect(paused).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query('notifications').collect()).toHaveLength(0);
    });
  });
});

describe('clearScanFailures', () => {
  it('clears the failure bookkeeping and keeps unrelated metadata', async () => {
    const t = convexTest(schema, modules);
    const websiteId = await provision(t);
    for (let i = 0; i < CONNECTION_FAILURES_BEFORE_PAUSE; i++) {
      await recordFailure(t, true);
    }

    await t.mutation(internal.websites.internal_mutations.clearScanFailures, {
      organizationId: ORG,
      domain: DOMAIN,
    });

    await t.run(async (ctx) => {
      const website = await ctx.db.get(websiteId);
      expect(website?.metadata?.corpusConnectionFailures ?? null).toBeNull();
      expect(website?.metadata?.lastScanAttemptAt ?? null).toBeNull();
      expect(website?.metadata?.scanPausedAt ?? null).toBeNull();
      expect(website?.metadata?.workflowId).toBe('wf_1');
    });
  });
});

describe('listWebsitesForScanScheduling', () => {
  it('projects the failure bookkeeping for the scheduler', async () => {
    const t = convexTest(schema, modules);
    await provision(t);
    for (let i = 0; i < CONNECTION_FAILURES_BEFORE_PAUSE; i++) {
      await recordFailure(t, true);
    }

    const sites = await t.query(
      internal.websites.internal_queries.listWebsitesForScanScheduling,
      {},
    );

    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      domain: DOMAIN,
      organizationId: ORG,
      connectionFailures: CONNECTION_FAILURES_BEFORE_PAUSE,
      scanPaused: true,
    });
    expect(typeof sites[0]?.lastAttemptAt).toBe('number');
  });
});
