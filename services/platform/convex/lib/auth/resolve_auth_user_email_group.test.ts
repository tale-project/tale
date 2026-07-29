import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BetterAuthUser } from '../../members/types';
import {
  createBetterAuthMemoryStore,
  createBetterAuthTestCtx,
  listUsers,
  seedMember,
  seedUser,
} from './test/better_auth_memory_adapter';

vi.mock('../../_generated/api', () => ({
  components: {
    betterAuth: {
      adapter: {
        findMany: 'betterAuth.adapter.findMany',
        create: 'betterAuth.adapter.create',
        updateMany: 'betterAuth.adapter.updateMany',
        deleteOne: 'betterAuth.adapter.deleteOne',
      },
    },
  },
}));

vi.mock('../../members/mirror_sync', () => ({
  upsertMemberMirror: vi.fn(async () => undefined),
  deleteMemberMirrorByMemberId: vi.fn(async () => undefined),
  upsertTeamMemberMirror: vi.fn(async () => undefined),
  deleteTeamMemberMirrorByTeamMemberId: vi.fn(async () => undefined),
}));

const MIGRATION_ID = '0.3.3/01_normalize_auth_user_emails';
const ORG = 'org_test';

function signupUser(
  partial: Partial<BetterAuthUser> & Pick<BetterAuthUser, '_id' | 'email'>,
): BetterAuthUser {
  return {
    name: partial.name ?? partial.email,
    emailVerified: partial.emailVerified ?? false,
    createdAt: partial.createdAt ?? 1_700_000_000_000,
    updatedAt: partial.updatedAt ?? 1_700_000_000_000,
    ...partial,
  };
}

describe('resolveAuthUserEmailGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('./resolve_auth_user_email_group');
  }

  it('renames a lone mixed-case user', async () => {
    const store = createBetterAuthMemoryStore();
    seedUser(
      store,
      signupUser({ _id: 'u1', email: 'Mixed@Example.com', name: 'Self' }),
    );
    const ctx = createBetterAuthTestCtx(store);
    const { resolveAuthUserEmailGroup } = await load();

    const result = await resolveAuthUserEmailGroup(ctx as never, 'u1');
    expect(result.action).toBe('renamed');
    expect(listUsers(store)).toEqual([
      expect.objectContaining({ _id: 'u1', email: 'mixed@example.com' }),
    ]);
  });

  it('merges case-variant duplicates into the lowercase canonical user', async () => {
    const store = createBetterAuthMemoryStore();
    const signup = signupUser({
      _id: 'signup',
      email: 'a.falco.stief@m365test4gematik.onmicrosoft.com',
      emailVerified: false,
      name: 'Falco Test-Tenant',
      createdAt: 1_700_000_000_000,
    });
    const scim = signupUser({
      _id: 'scim',
      email: 'a.falco.stief@M365Test4gematik.onmicrosoft.com',
      emailVerified: true,
      name: '(Admin) Stief, Falco',
      createdAt: 1_700_000_100_000,
    });
    seedUser(store, signup);
    seedUser(store, scim);
    seedMember(store, {
      _id: 'm-signup',
      organizationId: ORG,
      userId: 'signup',
      role: 'member',
      createdAt: 1,
    });
    seedMember(store, {
      _id: 'm-scim',
      organizationId: ORG,
      userId: 'scim',
      role: 'admin',
      createdAt: 2,
    });

    const ctx = createBetterAuthTestCtx(store);
    const { resolveAuthUserEmailGroup } = await load();

    const result = await resolveAuthUserEmailGroup(
      ctx as never,
      'signup',
      MIGRATION_ID,
    );
    expect(result.action).toBe('merged');

    const users = listUsers(store);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      _id: 'signup',
      email: 'a.falco.stief@m365test4gematik.onmicrosoft.com',
      emailVerified: true,
      name: 'Falco Test-Tenant',
    });

    const members = [...store.members.values()];
    expect(members.filter((m) => m.organizationId === ORG)).toHaveLength(1);
    expect(members[0]?.userId).toBe('signup');
    expect(members[0]?.role).toBe('admin');
  });

  it('skips merge when two owners share an org', async () => {
    const store = createBetterAuthMemoryStore();
    seedUser(store, signupUser({ _id: 'u1', email: 'Owner@Example.com' }));
    seedUser(store, signupUser({ _id: 'u2', email: 'owner@example.com' }));
    seedMember(store, {
      _id: 'm1',
      organizationId: ORG,
      userId: 'u1',
      role: 'owner',
      createdAt: 1,
    });
    seedMember(store, {
      _id: 'm2',
      organizationId: ORG,
      userId: 'u2',
      role: 'owner',
      createdAt: 2,
    });

    const ctx = createBetterAuthTestCtx(store);
    const { resolveAuthUserEmailGroup } = await load();

    const result = await resolveAuthUserEmailGroup(ctx as never, 'u1');
    expect(result.action).toBe('skipped');
    expect(listUsers(store)).toHaveLength(2);
  });

  it('snapshots duplicate users before deletion when migrationId is set', async () => {
    const store = createBetterAuthMemoryStore();
    seedUser(store, signupUser({ _id: 'a', email: 'a@b.com' }));
    seedUser(
      store,
      signupUser({ _id: 'b', email: 'A@b.com', emailVerified: true }),
    );

    const ctx = createBetterAuthTestCtx(store);
    const { resolveAuthUserEmailGroup } = await load();

    await resolveAuthUserEmailGroup(ctx as never, 'a', MIGRATION_ID);

    const snapshots = await ctx.db
      .query('migrationSnapshots')
      .filter(() => true)
      .collect();
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          migrationId: MIGRATION_ID,
          scope: 'component:betterAuth:user:b',
        }),
      ]),
    );
  });
});

describe('applyAuthEmailNormalizationBatch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('aggregates renamed, merged, skipped, and noop counts', async () => {
    const store = createBetterAuthMemoryStore();
    seedUser(store, signupUser({ _id: 'solo', email: 'Ok@Example.com' }));
    seedUser(store, signupUser({ _id: 'dup-a', email: 'dup@example.com' }));
    seedUser(store, signupUser({ _id: 'dup-b', email: 'Dup@Example.com' }));
    seedUser(store, signupUser({ _id: 'noop', email: 'noop@example.com' }));

    const ctx = createBetterAuthTestCtx(store);
    const { applyAuthEmailNormalizationBatch } =
      await import('./resolve_auth_user_email_group');

    const batch = await applyAuthEmailNormalizationBatch(
      ctx as never,
      null,
      10,
    );
    expect(batch.isDone).toBe(true);
    expect(batch.stats.renamed).toBe(1);
    expect(batch.stats.merged).toBeGreaterThanOrEqual(1);
    expect(batch.stats.noop).toBeGreaterThanOrEqual(1);
    expect(listUsers(store).length).toBeLessThan(4);
  });
});
