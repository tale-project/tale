/**
 * The model endpoints' two gates: the organization's switch on its
 * model-access policy (read strictly — unreadable configuration keeps the
 * door shut), then the caller's right (owner, admin or developer by role,
 * anyone else only through a live `tale:models.api` grant).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const policy = vi.hoisted(() => ({
  config: null as unknown,
  unreadable: false,
  reads: [] as { slug?: string; orgId?: string; strict: unknown }[],
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicy: vi.fn(
    async (slug: string, _type: string, options: { strict?: boolean }) => {
      policy.reads.push({ slug, strict: options.strict });
      if (policy.unreadable) throw new Error('GOVERNANCE_POLICY_INVALID');
      return policy.config;
    },
  ),
  readGovernancePolicyForOrg: vi.fn(
    async (
      _sql: unknown,
      orgId: string,
      _type: string,
      options: { strict?: boolean },
    ) => {
      policy.reads.push({ orgId, strict: options.strict });
      if (policy.unreadable) throw new Error('GOVERNANCE_POLICY_INVALID');
      return policy.config;
    },
  ),
}));

const grants = vi.hoisted(() => ({
  holdsCapability: vi.fn(async () => false),
}));
vi.mock('../governance/competence.ts', () => grants);

const { mayCallModelApi, readModelApiStanding, resolveModelApiGate } =
  await import('./access.ts');

const sql = {} as never;
const ON = {
  enabled: false,
  mode: 'blocklist',
  rules: [],
  modelApi: { enabled: true },
};

function caller(role: string) {
  return { organizationId: 'org-1', orgSlug: 'acme', userId: 'user-1', role };
}

beforeEach(() => {
  policy.config = ON;
  policy.unreadable = false;
  policy.reads = [];
  grants.holdsCapability.mockReset();
  grants.holdsCapability.mockResolvedValue(false);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resolveModelApiGate', () => {
  it('stays shut for every member while the organization has not turned it on [MAPI-R1]', async () => {
    policy.config = null;
    await expect(resolveModelApiGate(sql, caller('owner'))).resolves.toEqual({
      kind: 'disabled',
    });
    policy.config = { ...ON, modelApi: { enabled: false } };
    await expect(resolveModelApiGate(sql, caller('admin'))).resolves.toEqual({
      kind: 'disabled',
    });
    // A policy written before the switch existed reads as off.
    policy.config = { enabled: true, mode: 'allowlist', rules: [] };
    await expect(
      resolveModelApiGate(sql, caller('developer')),
    ).resolves.toEqual({ kind: 'disabled' });
    // The switch decides first: no grant is read for a closed door.
    expect(grants.holdsCapability).not.toHaveBeenCalled();
  });

  it('reads the policy strictly, by the slug the door resolved', async () => {
    await resolveModelApiGate(sql, caller('owner'));
    expect(policy.reads).toEqual([{ slug: 'acme', strict: true }]);
    await resolveModelApiGate(sql, {
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'owner',
    });
    expect(policy.reads[1]).toEqual({ orgId: 'org-1', strict: true });
  });

  it('keeps the door shut when the policy cannot be read [MAPI-R1]', async () => {
    policy.unreadable = true;
    await expect(resolveModelApiGate(sql, caller('owner'))).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('opens for owners, admins and developers by role, with the policy [MAPI-R2]', async () => {
    for (const role of ['owner', 'admin', 'developer', 'Developer']) {
      await expect(resolveModelApiGate(sql, caller(role))).resolves.toEqual({
        kind: 'open',
        policy: ON,
      });
    }
    expect(grants.holdsCapability).not.toHaveBeenCalled();
  });

  it('refuses any other member without the grant, and admits one who holds it [MAPI-R2]', async () => {
    await expect(resolveModelApiGate(sql, caller('member'))).resolves.toEqual({
      kind: 'forbidden',
    });
    await expect(resolveModelApiGate(sql, caller('editor'))).resolves.toEqual({
      kind: 'forbidden',
    });
    expect(grants.holdsCapability).toHaveBeenCalledWith(
      sql,
      'org-1',
      'user-1',
      'tale:models.api',
      expect.any(Number),
    );
    grants.holdsCapability.mockResolvedValue(true);
    await expect(resolveModelApiGate(sql, caller('member'))).resolves.toEqual({
      kind: 'open',
      policy: ON,
    });
  });

  it('never admits a disabled seat, whatever it holds [MAPI-R2]', async () => {
    grants.holdsCapability.mockResolvedValue(true);
    await expect(mayCallModelApi(sql, caller('disabled'))).resolves.toBe(false);
  });
});

describe('readModelApiStanding', () => {
  it('answers the switch and the right apart', async () => {
    await expect(
      readModelApiStanding(sql, caller('developer')),
    ).resolves.toEqual({ enabled: true, allowed: true });
    policy.config = null;
    await expect(readModelApiStanding(sql, caller('member'))).resolves.toEqual({
      enabled: false,
      allowed: false,
    });
    grants.holdsCapability.mockResolvedValue(true);
    await expect(readModelApiStanding(sql, caller('member'))).resolves.toEqual({
      enabled: false,
      allowed: true,
    });
  });

  it('reads an unreadable policy as off', async () => {
    policy.unreadable = true;
    await expect(readModelApiStanding(sql, caller('admin'))).resolves.toEqual({
      enabled: false,
      allowed: true,
    });
  });
});
