import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// First convex-test connector suite for the WebDAV backend. convex-test
// needs a module map keyed relative to the convex/ root (so a ref like
// internal.webdav.lock_mutations resolves to "webdav/lock_mutations"). Globbing
// from this file (convex/webdav/) yields mixed keys — "../documents/x.ts" for
// parent files and "./lock_mutations.ts" for same-dir files — so we normalize
// every key to be convex/-root-relative. (Kept in this .test.ts file, which the
// Convex bundler excludes, so the Vite-only import.meta.glob never ships.)
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[key.startsWith('../') ? key.slice(3) : `webdav/${key.slice(2)}`] =
    loader;
}

const ORG = 'org_test_lock';

type TestCtx = ReturnType<typeof convexTest>;

interface CreateLockArgs {
  organizationId: string;
  resourcePath: string;
  lockToken: string;
  ownerXml: string;
  depth: '0' | 'infinity';
  scope: 'exclusive' | 'shared';
  ownerUserId: string;
  appPasswordId: Id<'webdavAppPasswords'>;
  timeoutMs: number;
}

async function seedAppPassword(
  t: TestCtx,
  userId = 'user_1',
): Promise<Id<'webdavAppPasswords'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('webdavAppPasswords', {
      organizationId: ORG,
      userId,
      label: 'test',
      passwordHashed: 'hash',
      passwordPrefix: 'abcd',
      createdAt: 0,
    }),
  );
}

function lockArgs(
  appPasswordId: Id<'webdavAppPasswords'>,
  over: Partial<CreateLockArgs> = {},
): CreateLockArgs {
  return {
    organizationId: ORG,
    resourcePath: '/documents/a.txt',
    lockToken: 'tok1',
    ownerXml: '',
    depth: '0',
    scope: 'exclusive',
    ownerUserId: 'user_1',
    timeoutMs: 600_000,
    appPasswordId,
    ...over,
  };
}

describe('webdav lock_mutations (convex-test)', () => {
  it('createLock succeeds, then a conflicting exclusive lock on the same path → LOCKED', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, { lockToken: 'tok1' }),
    );
    await expect(
      t.mutation(
        internal.webdav.lock_mutations.createLock,
        lockArgs(appPasswordId, { lockToken: 'tok2', ownerUserId: 'user_2' }),
      ),
    ).rejects.toThrow(/LOCKED/);
  });

  it('a depth-infinity lock on an ancestor blocks a descendant lock → LOCKED', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, {
        resourcePath: '/documents/folder',
        depth: 'infinity',
        lockToken: 'anc',
      }),
    );
    await expect(
      t.mutation(
        internal.webdav.lock_mutations.createLock,
        lockArgs(appPasswordId, {
          resourcePath: '/documents/folder/child.txt',
          lockToken: 'child',
        }),
      ),
    ).rejects.toThrow(/LOCKED/);
  });

  it('refreshLock rejects a different owner → FORBIDDEN', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, { lockToken: 'tok1', ownerUserId: 'owner' }),
    );
    await expect(
      t.mutation(internal.webdav.lock_mutations.refreshLock, {
        lockToken: 'tok1',
        ownerUserId: 'someone-else',
        timeoutMs: 600_000,
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('refreshLock by the owner extends expiry', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, { lockToken: 'tok1', ownerUserId: 'owner' }),
    );
    const res = await t.mutation(internal.webdav.lock_mutations.refreshLock, {
      lockToken: 'tok1',
      ownerUserId: 'owner',
      timeoutMs: 600_000,
    });
    expect(res.lockToken).toBe('tok1');
    expect(res.ownerUserId).toBe('owner');
  });

  it('releaseLock rejects a non-owner (FORBIDDEN) and removes the lock for the owner', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, { lockToken: 'tok1', ownerUserId: 'owner' }),
    );
    await expect(
      t.mutation(internal.webdav.lock_mutations.releaseLock, {
        lockToken: 'tok1',
        ownerUserId: 'intruder',
        organizationId: ORG,
      }),
    ).rejects.toThrow(/FORBIDDEN/);

    await t.mutation(internal.webdav.lock_mutations.releaseLock, {
      lockToken: 'tok1',
      ownerUserId: 'owner',
      organizationId: ORG,
    });
    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query('webdavLocks')
        .withIndex('by_token', (q) => q.eq('lockToken', 'tok1'))
        .first(),
    );
    expect(remaining).toBeNull();
  });

  it('createLock evicts this app-password’s expired rows so the cap is not wedged', async () => {
    const t = convexTest(schema, modules);
    const appPasswordId = await seedAppPassword(t);
    // Seed 200 ALREADY-EXPIRED locks for this app-password (the cap is 200).
    await t.run(async (ctx) => {
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert('webdavLocks', {
          organizationId: ORG,
          resourcePath: `/documents/expired_${i}.txt`,
          lockToken: `expired_${i}`,
          ownerXml: '',
          depth: '0',
          scope: 'exclusive',
          ownerUserId: 'user_1',
          appPasswordId,
          expiresAt: 1, // long past
        });
      }
    });
    // A fresh lock must still succeed (expired rows evicted, not counted).
    await t.mutation(
      internal.webdav.lock_mutations.createLock,
      lockArgs(appPasswordId, {
        resourcePath: '/documents/fresh.txt',
        lockToken: 'fresh',
      }),
    );
    const live = await t.run(async (ctx) =>
      ctx.db
        .query('webdavLocks')
        .withIndex('by_appPasswordId', (q) =>
          q.eq('appPasswordId', appPasswordId),
        )
        .collect(),
    );
    // Only the one fresh lock remains; the 200 expired were swept.
    expect(live.length).toBe(1);
    expect(live[0].lockToken).toBe('fresh');
  });
});
