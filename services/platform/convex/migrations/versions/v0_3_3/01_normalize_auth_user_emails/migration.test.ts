/**
 * Hand-written (not on `defineMigrationTest`): Better Auth users live in the
 * component, unreachable through `ctx.db` in a convex-test world, and no
 * sanctioned support function seeds users (`support.seedAuthOrgs` creates
 * organizations only — see `world/manifest.testkit.ts` profile.authUsersSeeded).
 * The chain suite (`testing/chain.test.ts`) covers this migration's real
 * runner path as an empty-batch no-op; the normalization/merge logic itself
 * is covered by the `lib/auth` unit suites. This file asserts the registered
 * meta, the destructive gate through the real entrypoints, and the component
 * snapshot-restore semantics against a faked ctx.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../../../../_generated/api';
import schema from '../../../../schema';
import { requireMeta } from '../../../framework/registry.gen';
import { buildModules } from '../../../framework/test_helpers';

const DIR = 'migrations/versions/v0_3_3/01_normalize_auth_user_emails';
const modules = buildModules(import.meta.glob('../../../../**/*.*s'), DIR);

const meta = requireMeta('0.3.3/01_normalize_auth_user_emails');

describe('0.3.3/01_normalize_auth_user_emails', () => {
  it('is registered as a destructive component migration', () => {
    expect(meta.kind).toBe('component');
    expect(meta.destructive).toBe(true);
    expect(meta.snapshot).toBe('table-rows');
  });

  it('applyUp skips destructive steps without allowDestructive', async () => {
    const t = convexTest(schema, modules);
    const result = await t.action(
      internal.migrations.framework.entrypoints.applyUp,
      { only: [meta.id], allowDestructive: false },
    );
    expect(result.skipped.some((m) => m.id === meta.id)).toBe(true);
    expect(result.completed).not.toContain(meta.id);
  });

  it('restoreComponentSnapshotBatch recreates snapshotted Better Auth rows', async () => {
    const created: Array<{ model: string; data: Record<string, unknown> }> = [];
    const snapshots = [
      {
        _id: 'snap_1',
        migrationId: meta.id,
        scope: 'component:betterAuth:user:duplicate-id',
        payload: {
          _id: 'duplicate-id',
          email: 'dup@example.com',
          name: 'Dup User',
          emailVerified: true,
          createdAt: 1,
          updatedAt: 1,
        },
        createdAt: Date.now(),
      },
    ];
    const ledger = {
      _id: 'ledger_1',
      migrationId: meta.id,
      cursor: null as string | null,
    };
    const deletedSnapIds: string[] = [];

    const ctx = {
      db: {
        query: (table: string) => {
          if (table === 'migrationLedger') {
            return {
              withIndex: () => ({
                unique: async () => ledger,
              }),
            };
          }
          if (table === 'migrationSnapshots') {
            return {
              withIndex: () => ({
                paginate: async () => ({
                  page: snapshots,
                  isDone: true,
                  continueCursor: null,
                }),
              }),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
        patch: async (id: string, update: { cursor?: string | null }) => {
          if (id === ledger._id) {
            ledger.cursor = update.cursor ?? null;
          }
        },
        delete: async (id: string) => {
          deletedSnapIds.push(id);
        },
      },
      runMutation: async (
        _ref: unknown,
        args: { input: { model: string; data: Record<string, unknown> } },
      ) => {
        created.push(args.input);
        return { _id: 'restored-user-id' };
      },
    };

    const { restoreComponentSnapshotBatch } =
      await import('../../../framework/runner');
    // Registered Convex functions expose the raw handler as `_handler` —
    // the same seam convex-test resolves through.
    const handler = (
      restoreComponentSnapshotBatch as unknown as {
        _handler: (
          innerCtx: typeof ctx,
          args: { migrationId: string },
        ) => Promise<{ isDone: boolean; processed: number }>;
      }
    )._handler;

    const result = await handler(ctx, { migrationId: meta.id });

    expect(result.isDone).toBe(true);
    expect(result.processed).toBe(1);
    expect(created).toEqual([
      {
        model: 'user',
        data: {
          email: 'dup@example.com',
          name: 'Dup User',
          emailVerified: true,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    ]);
    expect(deletedSnapIds).toEqual(['snap_1']);
    expect(ledger.cursor).toBeNull();
  });
});
