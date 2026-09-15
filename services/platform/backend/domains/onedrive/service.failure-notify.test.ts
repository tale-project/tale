// @vitest-environment node

/**
 * The per-config sync job's outcome lane: a failed run opens (or keeps) the
 * failure episode on the row and tells the owner by the `sync-health` rule;
 * a successful run closes the episode, dismisses the owner's bell and hints
 * the open Documents page about what changed.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  dismissCloudSyncFailureNotifications,
  notifyUser,
} from '../collab/service.ts';
import {
  runSyncConfigJobWith,
  SyncAuthError,
  type SyncConfigRow,
  type SyncProviderAdapter,
} from './service.ts';
import { SYNC_FAILURE_NOTIFY_GRACE_MS } from './sync-health.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../collab/service.ts', () => ({
  notifyUser: vi.fn(),
  dismissCloudSyncFailureNotifications: vi.fn(),
}));
// Partial: the module also exports the folder-depth bound the chat shim's
// transitive import reads at load time.
vi.mock(import('../folders/paths.ts'), async (importOriginal) => ({
  ...(await importOriginal()),
  buildHubFolderPath: vi.fn(),
  findHubFolderByPath: vi.fn().mockResolvedValue('fld-parent'),
  getOrCreateHubFolderPath: vi.fn(),
  reapEmptyAncestorFolders: vi.fn().mockResolvedValue(undefined),
}));

interface Query {
  text: string;
  values: unknown[];
}

const NOW = 1_800_000_000_000;

const HEALTHY: SyncConfigRow = {
  id: 'cfg-1',
  organizationId: 'org-1',
  userId: 'owner-1',
  itemType: 'folder',
  itemId: 'folder-1',
  itemName: 'Reports',
  itemPath: 'Finance/Reports',
  targetBucket: 'documents',
  storagePrefix: null,
  teamId: null,
  status: 'active',
  lastSyncAt: null,
  lastSyncStatus: 'success',
  errorMessage: null,
  errorSince: null,
  failureNotifiedAt: null,
};

/** The real sequence: the claim fence hands back the previous outcome and
 * stamps the run marker, so the config read AFTER it only ever says
 * 'running' (the itest caught a lane that read the kind off that row —
 * every repeat looked like an escalation); every other statement answers
 * nothing (no mirrors, nothing to prune). */
function fakeSql(config: SyncConfigRow, log: Query[]): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    log.push({ text, values });
    if (text.includes("last_sync_status = 'running', updated_at_ms")) {
      return Promise.resolve([
        { id: config.id, previousSyncStatus: config.lastSyncStatus },
      ]);
    }
    if (text.includes('WHERE id = $ LIMIT 1')) {
      return Promise.resolve([{ ...config, lastSyncStatus: 'running' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

function adapter(overrides: Partial<SyncProviderAdapter>): SyncProviderAdapter {
  return {
    displayName: 'OneDrive',
    sourceProvider: 'onedrive',
    configTable: 'app.onedrive_sync_configs',
    configJobName: 'onedrive.sync_config',
    singletonPrefix: 'onedrive-sync-',
    metadataItemIdKeys: [],
    resolveToken: () => Promise.resolve({ success: true, token: 'tok' }),
    listFolderContents: () =>
      Promise.resolve({
        success: true,
        files: [{ id: 'f-1', name: 'a.txt', size: 3 }],
      }),
    getFileMetadata: () => Promise.resolve({ success: true, data: {} }),
    buildDownloadUrl: () => 'https://vendor.invalid/x',
    runImport: () =>
      Promise.resolve({
        success: true,
        successCount: 0,
        failedCount: 0,
        skippedCount: 1,
        results: [],
      }),
    ...overrides,
  };
}

/** The outcome stamp — the UPDATE that carries the episode columns. */
function outcomeStamp(log: Query[]): Query {
  const stamp = log.find((q) => q.text.includes('error_since_ms = $'));
  if (stamp === undefined) throw new Error('no outcome stamp written');
  return stamp;
}

/** Positional value of `column = $` in the stamp (the fake's `unsafe`
 * leaves a column NAME in the slot when the caller kept it). */
function stampValue(stamp: Query, column: string): unknown {
  const parts = stamp.text.split('$');
  const index = parts.findIndex((part) => part.endsWith(`${column} = `));
  if (index < 0) throw new Error(`${column} not in stamp`);
  return stamp.values[index];
}

const hintEntities = (): string[] =>
  vi
    .mocked(emitHintInTx)
    .mock.calls.map((call) => (call[1] as { entity: string }).entity);

const run = (
  config: SyncConfigRow,
  a: SyncProviderAdapter,
): Promise<Query[]> => {
  const log: Query[] = [];
  return runSyncConfigJobWith(fakeSql(config, log), a, {
    organizationId: config.organizationId,
    configId: config.id,
  }).then(() => log);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('runSyncConfigJobWith — failure episode', () => {
  it('a dead grant stamps needs-reauth, opens the episode and tells the owner at once', async () => {
    const log = await run(
      HEALTHY,
      adapter({
        resolveToken: () =>
          Promise.resolve({
            success: false,
            error: 'OneDrive is not authorized for importing.',
            needsReauth: true,
          }),
      }),
    );
    const stamp = outcomeStamp(log);
    expect(stampValue(stamp, 'status')).toBe('error');
    expect(stampValue(stamp, 'last_sync_status')).toBe('needs-reauth');
    expect(stampValue(stamp, 'error_since_ms')).toBe(NOW);
    expect(stampValue(stamp, 'failure_notified_at_ms')).toBe(NOW);

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'owner-1',
        organizationId: 'org-1',
        type: 'cloud_sync_failed',
        titleKey: 'cloudSyncNeedsReauth',
        bodyKey: 'cloudSyncNeedsReauthBody',
        resourceType: 'sync_config',
        resourceId: 'cfg-1',
        actorType: 'system',
        params: expect.objectContaining({
          provider: 'OneDrive',
          itemName: 'Reports',
          syncConfigId: 'cfg-1',
          hubFolderId: 'fld-parent',
        }),
      }),
    );
    // The badge appears: the folder rows refetch; no mirror changed.
    expect(hintEntities()).toEqual(['folder']);
  });

  it('a retryable failure opens the episode without a notice, then notifies once it is an hour old', async () => {
    const throttled = adapter({
      listFolderContents: () =>
        Promise.resolve({ success: false, error: 'HTTP 503 throttled' }),
      // The folder still exists at the source: not a source-deleted run.
      getFileMetadata: () => Promise.resolve({ success: true, data: {} }),
    });

    const first = outcomeStamp(await run(HEALTHY, throttled));
    expect(stampValue(first, 'last_sync_status')).toBe('error');
    expect(stampValue(first, 'error_since_ms')).toBe(NOW);
    // Kept, not stamped: the slot carries the column name.
    expect(stampValue(first, 'failure_notified_at_ms')).toBe(
      'failure_notified_at_ms',
    );
    expect(notifyUser).not.toHaveBeenCalled();
    expect(hintEntities()).toEqual(['folder']);

    vi.clearAllMocks();
    const since = NOW - SYNC_FAILURE_NOTIFY_GRACE_MS;
    const stale: SyncConfigRow = {
      ...HEALTHY,
      status: 'error',
      lastSyncStatus: 'error',
      errorMessage: 'HTTP 503 throttled',
      errorSince: since,
    };
    const later = outcomeStamp(await run(stale, throttled));
    expect(stampValue(later, 'error_since_ms')).toBe(since);
    expect(stampValue(later, 'failure_notified_at_ms')).toBe(NOW);
    expect(notifyUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        titleKey: 'cloudSyncFailed',
        bodyKey: 'cloudSyncFailedBody',
        params: expect.objectContaining({
          reason: expect.stringContaining('HTTP 503 throttled'),
        }),
      }),
    );
    // Same failure as last time: nothing on screen changes.
    expect(hintEntities()).toEqual([]);
  });

  it('a told episode is not repeated for the same cause', async () => {
    const told: SyncConfigRow = {
      ...HEALTHY,
      status: 'error',
      lastSyncStatus: 'needs-reauth',
      errorSince: NOW - 2 * SYNC_FAILURE_NOTIFY_GRACE_MS,
      failureNotifiedAt: NOW - 2 * SYNC_FAILURE_NOTIFY_GRACE_MS,
    };
    await run(
      told,
      adapter({
        resolveToken: () =>
          Promise.reject(new SyncAuthError('No valid OneDrive token')),
      }),
    );
    expect(notifyUser).not.toHaveBeenCalled();
    expect(dismissCloudSyncFailureNotifications).not.toHaveBeenCalled();
    expect(hintEntities()).toEqual([]);
  });

  it('a successful run closes the episode, dismisses the bell and refreshes the page', async () => {
    const failing: SyncConfigRow = {
      ...HEALTHY,
      status: 'error',
      lastSyncStatus: 'needs-reauth',
      errorMessage: 'No valid OneDrive token',
      errorSince: NOW - SYNC_FAILURE_NOTIFY_GRACE_MS,
      failureNotifiedAt: NOW - SYNC_FAILURE_NOTIFY_GRACE_MS,
    };
    const log = await run(
      failing,
      adapter({
        runImport: () =>
          Promise.resolve({
            success: true,
            successCount: 1,
            failedCount: 0,
            skippedCount: 0,
            results: [{ fileId: 'f-1', fileName: 'a.txt', status: 'success' }],
          }),
      }),
    );
    const stamp = outcomeStamp(log);
    expect(stampValue(stamp, 'status')).toBe('active');
    expect(stampValue(stamp, 'last_sync_status')).toBe('success');
    expect(stampValue(stamp, 'error_since_ms')).toBeNull();
    expect(stampValue(stamp, 'failure_notified_at_ms')).toBeNull();
    expect(dismissCloudSyncFailureNotifications).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: 'org-1', userId: 'owner-1', configId: 'cfg-1' },
    );
    // A mirror arrived AND the badge clears.
    expect(hintEntities()).toEqual(['document', 'folder']);
  });

  it('an unchanged healthy run hints nothing and dismisses nothing', async () => {
    await run(HEALTHY, adapter({}));
    expect(dismissCloudSyncFailureNotifications).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
    expect(hintEntities()).toEqual([]);
  });
});
