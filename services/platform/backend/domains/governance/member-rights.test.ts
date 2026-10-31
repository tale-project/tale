// @vitest-environment node

/**
 * A member's rights are the doors' own answers, with the reasons each door
 * weighs. The doors run for real here; only what they read is stood in
 * for: the member row, the register and the organization's policies.
 */

import type {
  ModelAccessConfig,
  OrgWideAudienceMode,
} from '@tale/shared/schemas/governance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberRight } from '../../../lib/shared/competences.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  type CompetenceRecord,
  holdsCapability,
  listRecordsVouchingFor,
} from './competence.ts';
import { readMemberRights } from './member-rights.ts';

vi.mock('../../auth/membership.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/membership.ts')>()),
  findOrganizationMember: vi.fn(),
}));
vi.mock('../../lib/org-config.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/org-config.ts')>()),
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('./competence.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./competence.ts')>()),
  holdsCapability: vi.fn(),
  listRecordsVouchingFor: vi.fn(),
}));

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;
const sql = {} as never;

let role = 'member';
let records: CompetenceRecord[] = [];
let modelAccess: ModelAccessConfig | null | 'unreadable' = {
  modelApi: { enabled: true },
} as ModelAccessConfig;
let skillSharing: OrgWideAudienceMode | null | 'unreadable' = null;

function grant(
  competence: string,
  extra: Partial<CompetenceRecord> = {},
): CompetenceRecord {
  return {
    id: `rec-${competence}`,
    userId: 'u2',
    teamId: null,
    teamName: null,
    competence,
    grantedBy: 'ada',
    grantedAt: NOW - 10 * DAY,
    expiresAt: null,
    revokedAt: null,
    revokedBy: null,
    evidence: null,
    ...extra,
  };
}

/** A grant to a team an admin added the member to. */
function teamGrant(
  competence: string,
  extra: Partial<CompetenceRecord> = {},
): CompetenceRecord {
  return grant(competence, {
    id: `rec-team-${competence}`,
    userId: null,
    teamId: 'team-1',
    teamName: 'Platform',
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'member';
  records = [];
  modelAccess = { modelApi: { enabled: true } } as ModelAccessConfig;
  skillSharing = null;
  vi.mocked(findOrganizationMember).mockImplementation(
    async (_sql, organizationId, userId) => ({
      id: 'm2',
      organizationId,
      userId,
      role,
    }),
  );
  vi.mocked(listRecordsVouchingFor).mockImplementation(async () => records);
  // The register's own rule, over the same records the read lists.
  vi.mocked(holdsCapability).mockImplementation(
    async (_sql, _organizationId, _userId, capability, now) =>
      records.some(
        (record) =>
          record.competence === capability &&
          record.revokedAt === null &&
          (record.expiresAt === null || record.expiresAt > now),
      ),
  );
  vi.mocked(readGovernancePolicyForOrg).mockImplementation(
    async (_sql, _organizationId, policyType) => {
      const value = policyType === 'model_access' ? modelAccess : skillSharing;
      if (value === 'unreadable') throw new Error('policy file is corrupt');
      if (policyType === 'skill_sharing' && value !== null) {
        return { orgWide: value } as never;
      }
      return value as never;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function rightsOf(): Promise<Record<string, MemberRight>> {
  const result = await readMemberRights(sql, {
    organizationId: 'o1',
    userId: 'u2',
    now: NOW,
  });
  if (result === null) throw new Error('expected a member');
  return Object.fromEntries(
    result.rights.map((right) => [right.capability, right]),
  );
}

describe('readMemberRights [GOV-R21]', () => {
  it('answers every platform right, in the closed set’s order, for the member’s role', async () => {
    role = 'owner';
    const result = await readMemberRights(sql, {
      organizationId: 'o1',
      userId: 'u2',
      now: NOW,
    });
    expect(result).toMatchObject({ userId: 'u2', role: 'owner' });
    expect(result?.rights.map((right) => right.capability)).toEqual([
      'tale:models.api',
      'tale:notifications.export',
      'tale:rest.act-as',
      'tale:skills.publish',
    ]);
  });

  it('names the role when it carries the right, with no grant to read', async () => {
    role = 'admin';
    const rights = await rightsOf();
    expect(rights['tale:notifications.export']).toEqual({
      capability: 'tale:notifications.export',
      held: true,
      grantId: null,
      reasons: [{ kind: 'role', standing: 'admits' }],
    });
    expect(rights['tale:rest.act-as']?.reasons).toEqual([
      { kind: 'role', standing: 'admits' },
    ]);
    expect(holdsCapability).not.toHaveBeenCalledWith(
      sql,
      'o1',
      'u2',
      'tale:notifications.export',
      NOW,
    );
  });

  it('names the missing grant when only a grant would admit the member', async () => {
    const rights = await rightsOf();
    expect(rights['tale:rest.act-as']).toEqual({
      capability: 'tale:rest.act-as',
      held: false,
      grantId: null,
      reasons: [{ kind: 'role', standing: 'grant' }, { kind: 'no-grant' }],
    });
  });

  it('names who granted a live grant and until when, and offers it to revoke', async () => {
    records = [
      grant('tale:notifications.export', { expiresAt: NOW + 30 * DAY }),
    ];
    const rights = await rightsOf();
    expect(rights['tale:notifications.export']).toEqual({
      capability: 'tale:notifications.export',
      held: true,
      grantId: 'rec-tale:notifications.export',
      reasons: [
        { kind: 'role', standing: 'grant' },
        {
          kind: 'grant',
          recordId: 'rec-tale:notifications.export',
          grantedBy: 'ada',
          grantedAt: NOW - 10 * DAY,
          expiresAt: NOW + 30 * DAY,
          status: 'active',
        },
      ],
    });
  });

  it('reads an expired grant as expired: it no longer admits, and there is nothing to revoke', async () => {
    records = [
      grant('tale:rest.act-as', { expiresAt: NOW - DAY }),
      grant('tale:skills.publish', { revokedAt: NOW - DAY, revokedBy: 'ada' }),
    ];
    skillSharing = 'admins';
    const rights = await rightsOf();
    expect(rights['tale:rest.act-as']).toMatchObject({
      held: false,
      grantId: null,
      reasons: [
        { kind: 'role', standing: 'grant' },
        { kind: 'grant', status: 'expired', expiresAt: NOW - DAY },
      ],
    });
    // A revoked grant is history, not a reason.
    expect(rights['tale:skills.publish']?.reasons).toEqual([
      { kind: 'policy', policy: 'skill_sharing', mode: 'admins' },
      { kind: 'role', standing: 'grant' },
      { kind: 'no-grant' },
    ]);
  });

  it('names the team whose grant admits the member, and leaves the switch to a grant of their own', async () => {
    records = [teamGrant('tale:rest.act-as', { expiresAt: NOW + 30 * DAY })];
    const rights = await rightsOf();
    expect(rights['tale:rest.act-as']).toEqual({
      capability: 'tale:rest.act-as',
      held: true,
      grantId: null,
      reasons: [
        { kind: 'role', standing: 'grant' },
        {
          kind: 'team',
          recordId: 'rec-team-tale:rest.act-as',
          teamId: 'team-1',
          teamName: 'Platform',
          grantedBy: 'ada',
          grantedAt: NOW - 10 * DAY,
          expiresAt: NOW + 30 * DAY,
          status: 'active',
        },
      ],
    });
  });

  it('names the member’s own grant first, then each team’s, an expired one as expired', async () => {
    records = [
      teamGrant('tale:notifications.export', {
        id: 'rec-team-a',
        teamId: 'team-a',
        teamName: 'Ops',
        expiresAt: NOW - DAY,
      }),
      grant('tale:notifications.export'),
      teamGrant('tale:notifications.export', {
        id: 'rec-team-b',
        teamId: 'team-b',
        teamName: 'Support',
      }),
    ];
    const right = (await rightsOf())['tale:notifications.export'];
    expect(right).toMatchObject({
      held: true,
      grantId: 'rec-tale:notifications.export',
      reasons: [
        { kind: 'role', standing: 'grant' },
        { kind: 'grant', recordId: 'rec-tale:notifications.export' },
        {
          kind: 'team',
          recordId: 'rec-team-a',
          teamName: 'Ops',
          status: 'expired',
        },
        {
          kind: 'team',
          recordId: 'rec-team-b',
          teamName: 'Support',
          status: 'active',
        },
      ],
    });
    expect(right?.reasons).toHaveLength(4);
  });

  it('names an expired team grant in place of the missing grant: it admits the member no longer', async () => {
    records = [teamGrant('tale:rest.act-as', { expiresAt: NOW - DAY })];
    const right = (await rightsOf())['tale:rest.act-as'];
    expect(right).toMatchObject({
      held: false,
      grantId: null,
      reasons: [
        { kind: 'role', standing: 'grant' },
        { kind: 'team', status: 'expired' },
      ],
    });
    expect(right?.reasons).not.toContainEqual({ kind: 'no-grant' });
  });

  it('names the organization’s model endpoints switch, which shuts the door for every role and grant while off', async () => {
    modelAccess = null;
    role = 'developer';
    let rights = await rightsOf();
    expect(rights['tale:models.api']).toEqual({
      capability: 'tale:models.api',
      held: false,
      grantId: null,
      reasons: [
        { kind: 'organization', setting: 'model_api', state: 'off' },
        { kind: 'role', standing: 'admits' },
      ],
    });

    role = 'member';
    records = [grant('tale:models.api')];
    rights = await rightsOf();
    expect(rights['tale:models.api']).toMatchObject({
      held: false,
      grantId: 'rec-tale:models.api',
      reasons: [
        { kind: 'organization', setting: 'model_api', state: 'off' },
        { kind: 'role', standing: 'grant' },
        { kind: 'grant', status: 'active' },
      ],
    });

    modelAccess = { modelApi: { enabled: true } } as ModelAccessConfig;
    rights = await rightsOf();
    expect(rights['tale:models.api']).toMatchObject({
      held: true,
      reasons: [
        { kind: 'organization', setting: 'model_api', state: 'on' },
        { kind: 'role', standing: 'grant' },
        { kind: 'grant', status: 'active' },
      ],
    });
  });

  it('reads a model access policy that cannot be read as unreadable, and the door shut', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    modelAccess = 'unreadable';
    role = 'owner';
    const rights = await rightsOf();
    expect(rights['tale:models.api']).toMatchObject({
      held: false,
      reasons: [
        { kind: 'organization', setting: 'model_api', state: 'unreadable' },
        { kind: 'role', standing: 'admits' },
      ],
    });
    expect(logged).toHaveBeenCalled();
  });

  it.each<{
    mode: OrgWideAudienceMode | null;
    who: string;
    standing: 'admits' | 'grant';
  }>([
    { mode: null, who: 'member', standing: 'admits' },
    { mode: 'everyone', who: 'member', standing: 'admits' },
    { mode: 'editors', who: 'editor', standing: 'admits' },
    { mode: 'editors', who: 'member', standing: 'grant' },
    { mode: 'admins', who: 'editor', standing: 'grant' },
    { mode: 'admins', who: 'admin', standing: 'admits' },
  ])(
    'names the skill sharing policy ($mode) and what it says of a $who',
    async ({ mode, who, standing }) => {
      skillSharing = mode;
      role = who;
      const right = (await rightsOf())['tale:skills.publish'];
      expect(right?.held).toBe(standing === 'admits');
      expect(right?.reasons.slice(0, 2)).toEqual([
        {
          kind: 'policy',
          policy: 'skill_sharing',
          mode: mode ?? 'everyone',
        },
        { kind: 'role', standing },
      ]);
    },
  );

  it('reads a skill sharing policy that cannot be read as reserved to admins', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    skillSharing = 'unreadable';
    role = 'editor';
    records = [grant('tale:skills.publish')];
    const right = (await rightsOf())['tale:skills.publish'];
    expect(right).toMatchObject({
      held: true,
      reasons: [
        { kind: 'policy', policy: 'skill_sharing', mode: 'admins' },
        { kind: 'role', standing: 'grant' },
        { kind: 'grant', status: 'active' },
      ],
    });
  });

  it('gives a disabled seat no right, and still names the grant it holds', async () => {
    role = 'disabled';
    records = [grant('tale:notifications.export')];
    const rights = await rightsOf();
    for (const right of Object.values(rights)) {
      expect(right.held).toBe(false);
      expect(right.reasons).toContainEqual({
        kind: 'role',
        standing: 'refuses',
      });
      expect(right.reasons).not.toContainEqual({ kind: 'no-grant' });
    }
    expect(rights['tale:notifications.export']).toMatchObject({
      grantId: 'rec-tale:notifications.export',
      reasons: [
        { kind: 'role', standing: 'refuses' },
        { kind: 'grant', status: 'active' },
      ],
    });
  });

  it('answers null for a user who is not a member, and reads nothing more', async () => {
    vi.mocked(findOrganizationMember).mockResolvedValueOnce(null);
    expect(
      await readMemberRights(sql, {
        organizationId: 'o1',
        userId: 'stranger',
        now: NOW,
      }),
    ).toBeNull();
    expect(listRecordsVouchingFor).not.toHaveBeenCalled();
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
  });
});
