// @vitest-environment node

/**
 * The Auto picker's governance read over REAL catalog id shapes. A vendor
 * slash (`z-ai/glm-5.1`) is part of the id, a colon is the only qualifier
 * (`openrouter:z-ai/glm-5.1`), and `@fp8` is a quantization pin — the rule
 * lists and the candidates must normalize through the one ref grammar, or an
 * allowlist bricks Auto (every slash id drops → "no accessible model") while
 * a blocklist leaks (blocked slash ids stay eligible, Auto picks them, and
 * the turn-boundary check then refuses the message).
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findOrganizationMember, getUserTeamIds, readGovernancePolicyForOrg } =
  vi.hoisted(() => ({
    findOrganizationMember: vi.fn(),
    getUserTeamIds: vi.fn(),
    readGovernancePolicyForOrg: vi.fn(),
  }));

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember,
  getUserTeamIds,
}));
vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));

import { resolveModelGovernanceForUser } from './service.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every db read is mocked above; the handle is never dereferenced
const sql = {} as Sql;
const ORG = 'org_governance_refs';
const USER = 'user_1';

/** The picker's candidate world: bare catalog ids across id dialects. */
const CANDIDATES = [
  'z-ai/glm-5.1',
  'glm-5.1',
  'anthropic/claude-sonnet-4.6',
  'claude-sonnet-4-6',
  'gpt-5.5',
];

function policies(config: {
  model_access?: unknown;
  default_models?: unknown;
}): void {
  readGovernancePolicyForOrg.mockImplementation(
    (_sql: unknown, _org: string, policyType: string) =>
      Promise.resolve(
        policyType === 'model_access'
          ? (config.model_access ?? null)
          : policyType === 'default_models'
            ? (config.default_models ?? null)
            : null,
      ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  findOrganizationMember.mockResolvedValue({ role: 'member' });
  getUserTeamIds.mockResolvedValue([]);
});

describe('resolveModelGovernanceForUser — candidate ids over the ref grammar', () => {
  it('returns every candidate unchanged when no model_access policy exists', async () => {
    policies({});
    const result = await resolveModelGovernanceForUser(sql, {
      organizationId: ORG,
      userId: USER,
      supportedModels: CANDIDATES,
    });
    expect(result.accessibleModelRefs).toEqual(CANDIDATES);
  });

  it('allowlist: keeps slash-bearing ids the rule names and drops the rest', async () => {
    policies({
      model_access: {
        enabled: true,
        mode: 'allowlist',
        rules: [
          {
            scope: 'default',
            // A bare slash id, a provider-qualified one with a quantization
            // pin, and a plain id — the three spellings an admin writes.
            allowedModels: [
              'z-ai/glm-5.1',
              'openrouter:anthropic/claude-sonnet-4.6@fp8',
              'gpt-5.5',
            ],
          },
        ],
      },
    });
    const result = await resolveModelGovernanceForUser(sql, {
      organizationId: ORG,
      userId: USER,
      supportedModels: CANDIDATES,
    });
    // `glm-5.1` (no vendor) and `claude-sonnet-4-6` are DIFFERENT ids from
    // the allowlisted slash forms — neither may leak in.
    expect(result.accessibleModelRefs).toEqual([
      'z-ai/glm-5.1',
      'anthropic/claude-sonnet-4.6',
      'gpt-5.5',
    ]);
  });

  it('blocklist: a blocked slash id is excluded instead of leaking into the pool', async () => {
    policies({
      model_access: {
        enabled: true,
        mode: 'blocklist',
        rules: [
          {
            scope: 'default',
            allowedModels: [],
            blockedModels: ['anthropic/claude-sonnet-4.6', 'z-ai/glm-5.1'],
          },
        ],
      },
    });
    const result = await resolveModelGovernanceForUser(sql, {
      organizationId: ORG,
      userId: USER,
      supportedModels: CANDIDATES,
    });
    expect(result.accessibleModelRefs).toEqual([
      'glm-5.1',
      'claude-sonnet-4-6',
      'gpt-5.5',
    ]);
  });

  it('agrees with the turn-boundary verdict for every candidate it keeps or drops', async () => {
    policies({
      model_access: {
        enabled: true,
        mode: 'allowlist',
        rules: [{ scope: 'default', allowedModels: ['z-ai/glm-5.1'] }],
      },
    });
    const picker = await resolveModelGovernanceForUser(sql, {
      organizationId: ORG,
      userId: USER,
      supportedModels: CANDIDATES,
    });
    for (const candidate of CANDIDATES) {
      const verdict = await resolveModelGovernanceForUser(sql, {
        organizationId: ORG,
        userId: USER,
        supportedModels: [],
        explicitModelId: candidate,
      });
      expect(verdict.explicitAllowed?.allowed).toBe(
        picker.accessibleModelRefs.includes(candidate),
      );
    }
  });

  it("drops the admin's default_models pin when the access policy refuses it", async () => {
    policies({
      model_access: {
        enabled: true,
        mode: 'allowlist',
        rules: [{ scope: 'default', allowedModels: ['z-ai/glm-5.1'] }],
      },
      default_models: {
        enabled: true,
        rules: [
          {
            scope: 'default',
            providerName: 'openrouter',
            modelId: 'anthropic/claude-sonnet-4.6',
          },
        ],
      },
    });
    const result = await resolveModelGovernanceForUser(sql, {
      organizationId: ORG,
      userId: USER,
      supportedModels: CANDIDATES,
    });
    expect(result.defaultModel).toBeUndefined();
    expect(result.accessibleModelRefs).toEqual(['z-ai/glm-5.1']);
  });
});
