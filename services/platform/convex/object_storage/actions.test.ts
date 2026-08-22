import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `action(config)` returns the config so `.handler` is directly invokable
// (same codegen-surface mock as knowledge/actions.test.ts).
vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

vi.mock('../_generated/api', () => ({
  internal: {
    object_storage: {
      file_actions: {
        readConnection: 'readConnection',
        writeConnection: 'writeConnection',
        deleteConnection: 'deleteConnection',
        probeConnection: 'probeConnection',
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn(),
}));

vi.mock('../../lib/permissions/ability', () => ({
  defineAbilityFor: vi.fn(),
}));

import { defineAbilityFor } from '../../lib/permissions/ability';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  deleteObjectStorageConnection,
  saveObjectStorageConnection,
  testObjectStorageConnection,
} from './actions';

interface ActionLike {
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
}
function asAction(a: unknown): ActionLike {
  return a as ActionLike;
}

const VALID = {
  organizationId: 'org_123',
  region: 'us-east-1',
  endpoint: 'https://s3.example.com',
  forcePathStyle: true,
  bucket: 'org-blobs',
  prefix: 'tale',
  accessKeyId: 'AKIA_test',
  secretAccessKey: 'secret_test',
};

/** The bucket coordinates the probe delegate receives after a clean parse. */
const PARSED_CONNECTION = {
  region: 'us-east-1',
  endpoint: 'https://s3.example.com',
  forcePathStyle: true,
  bucket: 'org-blobs',
  prefix: 'tale',
};

/** Set the caller's org role + whether it may write org settings. */
function setCaller(role: string, canWrite: boolean): void {
  vi.mocked(requireOrgMembershipById).mockResolvedValue({
    orgId: 'org_123',
    orgSlug: 'acme',
    userId: 'user_1',
    email: 'a@acme.example',
    name: 'A',
    member: { _id: 'm1', role },
  });
  vi.mocked(defineAbilityFor).mockReturnValue({
    cannot: () => !canWrite,
  } as unknown as ReturnType<typeof defineAbilityFor>);
}

function makeCtx(runActionResult: unknown = { ok: true }): {
  runAction: ReturnType<typeof vi.fn>;
} {
  return { runAction: vi.fn().mockResolvedValue(runActionResult) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('testObjectStorageConnection (the org bucket probe)', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx();
    await expect(
      asAction(testObjectStorageConnection).handler(ctx, VALID),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('gates an admin, then delegates to the probe with the parsed connection + both keys', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ ok: true });
    const result = await asAction(testObjectStorageConnection).handler(
      ctx,
      VALID,
    );
    expect(ctx.runAction).toHaveBeenCalledWith('probeConnection', {
      ...PARSED_CONNECTION,
      accessKeyId: 'AKIA_test',
      secretAccessKey: 'secret_test',
      // Passed so the probe can fall back to the stored secret when the
      // write-only key fields are left blank on a re-test after Save.
      orgSlug: 'acme',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects an invalid endpoint before probing (no runAction)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx();
    const result = (await asAction(testObjectStorageConnection).handler(ctx, {
      ...VALID,
      endpoint: 'ftp://evil.example',
    })) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid object-storage connection/);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('still forwards orgSlug when BOTH keys are omitted (stored-secret fallback for Save-then-Test)', async () => {
    setCaller('admin', true);
    const ctx = makeCtx({ ok: true });
    const {
      accessKeyId: _accessKeyId,
      secretAccessKey: _secretAccessKey,
      ...withoutKeys
    } = VALID;
    await asAction(testObjectStorageConnection).handler(ctx, withoutKeys);
    expect(ctx.runAction).toHaveBeenCalledWith(
      'probeConnection',
      expect.objectContaining({
        orgSlug: 'acme',
        accessKeyId: undefined,
        secretAccessKey: undefined,
      }),
    );
  });
});

describe('saveObjectStorageConnection', () => {
  it('rejects a non-admin caller', async () => {
    setCaller('member', false);
    const ctx = makeCtx(null);
    await expect(
      asAction(saveObjectStorageConnection).handler(ctx, VALID),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });

  it('writes the connection under the caller-resolved org slug', async () => {
    setCaller('owner', true);
    const ctx = makeCtx(null);
    await asAction(saveObjectStorageConnection).handler(ctx, VALID);
    expect(ctx.runAction).toHaveBeenCalledWith('writeConnection', {
      orgSlug: 'acme',
      ...PARSED_CONNECTION,
      accessKeyId: 'AKIA_test',
      secretAccessKey: 'secret_test',
    });
  });

  it('rejects an invalid connection with a ConvexError', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    await expect(
      asAction(saveObjectStorageConnection).handler(ctx, {
        ...VALID,
        endpoint: 'ftp://evil.example',
      }),
    ).rejects.toBeInstanceOf(ConvexError);
    expect(ctx.runAction).not.toHaveBeenCalled();
  });
});

describe('deleteObjectStorageConnection', () => {
  it('reverts to default under the caller-resolved org slug', async () => {
    setCaller('admin', true);
    const ctx = makeCtx(null);
    await asAction(deleteObjectStorageConnection).handler(ctx, {
      organizationId: 'org_123',
    });
    expect(ctx.runAction).toHaveBeenCalledWith('deleteConnection', {
      orgSlug: 'acme',
    });
  });
});
