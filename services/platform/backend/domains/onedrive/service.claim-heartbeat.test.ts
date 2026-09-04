/**
 * The per-config sync claim: a 'running' stamp older than the stale window is
 * treated as a crashed worker and re-claimed. A LIVE run must therefore keep
 * its stamp fresh for as long as it runs — otherwise a sync that merely takes
 * longer than the window is claimed again by the next cron tick and runs
 * twice concurrently.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSyncConfigJobWith, type SyncProviderAdapter } from './service.ts';

interface Query {
  text: string;
  values: unknown[];
}

const CONFIG_ROW = {
  id: 'cfg-1',
  organizationId: 'org-1',
  userId: 'user-1',
  itemType: 'folder',
  itemId: 'folder-1',
  itemName: 'Reports',
  itemPath: null,
  targetBucket: 'documents',
  storagePrefix: null,
  teamId: null,
  status: 'active',
  lastSyncAt: null,
  lastSyncStatus: null,
  errorMessage: null,
};

function fakeSql(log: Query[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    // The claim fence.
    if (text.includes("last_sync_status = 'running', updated_at_ms")) {
      return Promise.resolve([{ id: 'cfg-1' }]);
    }
    // getSyncConfigRow.
    if (text.includes('WHERE id = $ LIMIT 1')) {
      return Promise.resolve([CONFIG_ROW]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

const heartbeats = (log: Query[]): number =>
  log.filter(
    (q) =>
      q.text.includes('SET updated_at_ms = $') &&
      q.text.includes("last_sync_status = 'running'"),
  ).length;

const finalStamps = (log: Query[]): number =>
  log.filter((q) => q.text.includes('last_sync_at_ms = $')).length;

/** An adapter whose token resolve blocks until the test releases it — the
 * "long sync" — then fails so the run ends without touching the reconcile
 * lane. */
function blockingAdapter(gate: Promise<void>): SyncProviderAdapter {
  return {
    displayName: 'Fake Drive',
    sourceProvider: 'fake',
    configTable: 'app.onedrive_sync_configs',
    configJobName: 'onedrive.sync_config',
    singletonPrefix: 'fake-sync-',
    metadataItemIdKeys: [],
    resolveToken: async () => {
      await gate;
      return { success: false };
    },
    listFolderContents: () => Promise.resolve({ success: false }),
    getFileMetadata: () => Promise.resolve({ success: false }),
    buildDownloadUrl: () => '',
    runImport: () =>
      Promise.resolve({
        results: [],
        successCount: 0,
        skippedCount: 0,
        failedCount: 0,
      }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the fields the claim path touches are exercised
  } as unknown as SyncProviderAdapter;
}

describe('runSyncConfigJobWith — claim heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews the claim stamp while the sync runs and stops when it ends', async () => {
    const log: Query[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const run = runSyncConfigJobWith(
      fakeSql(log),
      blockingAdapter(gate),
      { organizationId: 'org-1', configId: 'cfg-1' },
      { heartbeatMs: 1_000 },
    );

    // Three heartbeat periods into a still-running sync: three renewals, no
    // outcome stamp yet.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(heartbeats(log)).toBe(3);
    expect(finalStamps(log)).toBe(0);
    const renewal = log.find((q) => q.text.includes('SET updated_at_ms = $'));
    expect(renewal?.values).toContain('cfg-1');
    expect(renewal?.values).toContain('org-1');

    release();
    await run;
    expect(finalStamps(log)).toBe(1);

    // The interval is cleared with the run: no renewals after the outcome.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(heartbeats(log)).toBe(3);
  });

  it('does not heartbeat when the claim was not won', async () => {
    const log: Query[] = [];
    const sql = fakeSql(log);
    // A losing claim answers no row.
    const losing = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join('$');
        log.push({ text, values });
        return Promise.resolve([]);
      },
      { unsafe: (t: string) => t },
    );
    void sql;
    await runSyncConfigJobWith(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
      losing as unknown as Sql,
      blockingAdapter(Promise.resolve()),
      { organizationId: 'org-1', configId: 'cfg-1' },
      { heartbeatMs: 1_000 },
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(heartbeats(log)).toBe(0);
  });
});
