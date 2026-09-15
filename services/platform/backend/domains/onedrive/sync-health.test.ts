// @vitest-environment node

/**
 * The cloud-sync health lane: one notice per failure episode, at once for a
 * dead grant and after an hour for anything else, re-issued only when the
 * cause escalates; and the listing index that lets an errored config still
 * decorate its folder (the active-only map used to drop it).
 */

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import {
  decideFailureNotification,
  failureReason,
  loadSyncHealthIndex,
  resolveSyncItemListingFolderId,
  SYNC_FAILURE_NOTIFY_GRACE_MS,
} from './sync-health.ts';

vi.mock('../collab/service.ts', () => ({
  notifyUser: vi.fn(),
  dismissCloudSyncFailureNotifications: vi.fn(),
}));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../folders/paths.ts', () => ({
  findHubFolderByPath: vi.fn().mockResolvedValue('fld-parent'),
}));

const NOW = 1_800_000_000_000;
const HEALTHY = {
  errorSince: null,
  failureNotifiedAt: null,
  lastSyncStatus: 'success',
};

describe('decideFailureNotification', () => {
  it('opens the episode on the first failure and waits for a retryable error', () => {
    const decision = decideFailureNotification(HEALTHY, {
      now: NOW,
      needsReauth: false,
    });
    expect(decision).toEqual({
      errorSince: NOW,
      lastSyncStatus: 'error',
      notify: false,
    });
  });

  it('tells the owner at once when the grant is dead', () => {
    const decision = decideFailureNotification(HEALTHY, {
      now: NOW,
      needsReauth: true,
    });
    expect(decision).toEqual({
      errorSince: NOW,
      lastSyncStatus: 'needs-reauth',
      notify: true,
    });
  });

  it('keeps the episode start across runs and notifies once it is an hour old', () => {
    const since = NOW - SYNC_FAILURE_NOTIFY_GRACE_MS;
    const before = { ...HEALTHY, errorSince: since, lastSyncStatus: 'error' };
    expect(
      decideFailureNotification(before, { now: NOW - 1, needsReauth: false })
        .notify,
    ).toBe(false);
    const due = decideFailureNotification(before, {
      now: NOW,
      needsReauth: false,
    });
    expect(due).toEqual({
      errorSince: since,
      lastSyncStatus: 'error',
      notify: true,
    });
  });

  it('never repeats a notice for the same cause', () => {
    const before = {
      errorSince: NOW - 3 * SYNC_FAILURE_NOTIFY_GRACE_MS,
      failureNotifiedAt: NOW - 2 * SYNC_FAILURE_NOTIFY_GRACE_MS,
      lastSyncStatus: 'error',
    };
    expect(
      decideFailureNotification(before, { now: NOW, needsReauth: false })
        .notify,
    ).toBe(false);
    const reauthTold = { ...before, lastSyncStatus: 'needs-reauth' };
    expect(
      decideFailureNotification(reauthTold, { now: NOW, needsReauth: true })
        .notify,
    ).toBe(false);
  });

  it('re-issues the notice when a told episode escalates to a dead grant', () => {
    const before = {
      errorSince: NOW - 2 * SYNC_FAILURE_NOTIFY_GRACE_MS,
      failureNotifiedAt: NOW - SYNC_FAILURE_NOTIFY_GRACE_MS,
      lastSyncStatus: 'error',
    };
    const decision = decideFailureNotification(before, {
      now: NOW,
      needsReauth: true,
    });
    expect(decision.notify).toBe(true);
    expect(decision.lastSyncStatus).toBe('needs-reauth');
    expect(decision.errorSince).toBe(before.errorSince);
  });
});

describe('failureReason', () => {
  it('collapses whitespace, bounds the length and names an empty message', () => {
    expect(failureReason('  HTTP 503\n  throttled ')).toBe(
      'HTTP 503 throttled',
    );
    expect(failureReason(null)).toBe('unknown error');
    expect(failureReason('')).toBe('unknown error');
    const long = failureReason('x'.repeat(500));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('resolveSyncItemListingFolderId', () => {
  it('answers the parent of the synced item, and null for a top-level item', async () => {
    const sql = (() => Promise.resolve([])) as unknown as Sql;
    await expect(
      resolveSyncItemListingFolderId(sql, {
        organizationId: 'org-1',
        itemPath: 'Finance/Reports',
        itemName: 'Reports',
      }),
    ).resolves.toBe('fld-parent');
    await expect(
      resolveSyncItemListingFolderId(sql, {
        organizationId: 'org-1',
        itemPath: null,
        itemName: 'Reports',
      }),
    ).resolves.toBeNull();
  });
});

describe('loadSyncHealthIndex', () => {
  it('indexes active AND errored configs of both providers, by path and by id', async () => {
    const queries: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('$');
      queries.push({ text, values });
      if (values.includes('app.onedrive_sync_configs')) {
        return Promise.resolve([
          {
            id: 'cfg-od',
            itemPath: 'Reports',
            status: 'error',
            lastSyncStatus: 'needs-reauth',
            lastSyncAt: 10,
            errorSince: 5,
            errorMessage: 'No valid OneDrive token',
            ownerUserId: 'user-1',
            ownerName: null,
            ownerEmail: 'owner@example.com',
          },
        ]);
      }
      if (values.includes('app.google_drive_sync_configs')) {
        return Promise.resolve([
          {
            id: 'cfg-gd',
            itemPath: 'Drive/Q3',
            status: 'active',
            lastSyncStatus: 'success',
            lastSyncAt: 20,
            errorSince: null,
            errorMessage: null,
            ownerUserId: 'user-2',
            ownerName: 'Dana',
            ownerEmail: 'dana@example.com',
          },
        ]);
      }
      return Promise.resolve([]);
    };
    const sql = Object.assign(tag, {
      unsafe: (text: string) => text,
    }) as unknown as Sql;

    const index = await loadSyncHealthIndex(sql, 'org-1');

    // Both tables are read, each restricted to syncable statuses.
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.text.replace(/\s+/g, ' ')).toContain(
        "status IN ('active', 'error')",
      );
      expect(query.values).toContain('org-1');
    }
    expect(index.byPath.get('Reports')).toEqual({
      configId: 'cfg-od',
      provider: 'onedrive',
      status: 'failed',
      needsReauth: true,
      lastSyncAt: 10,
      errorSince: 5,
      errorMessage: 'No valid OneDrive token',
      ownerUserId: 'user-1',
      // The email stands in for a member without a display name.
      ownerName: 'owner@example.com',
    });
    expect(index.byPath.get('Drive/Q3')).toEqual({
      configId: 'cfg-gd',
      provider: 'google_drive',
      status: 'healthy',
      needsReauth: false,
      lastSyncAt: 20,
      ownerUserId: 'user-2',
      ownerName: 'Dana',
    });
    expect(index.byConfigId.get('cfg-od')?.status).toBe('failed');
    expect(index.byConfigId.get('cfg-gd')?.status).toBe('healthy');
  });
});
