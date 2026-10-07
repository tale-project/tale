// @vitest-environment node

/**
 * Who may give a skill the whole organization as its audience: the
 * organization's `skill_sharing` policy (a missing file is `everyone`), the
 * role ladder under it, and a live `tale:skills.publish` grant — one answer
 * every skill write door, the library listing and `GET /api/v1/me` share.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { holdsCapability } from '../governance/competence.ts';
import {
  auditIfPublishRefused,
  maySkillPublishOrgWide,
  publishRefusalSlug,
  resolveSkillPublishing,
} from './publish.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(),
}));
vi.mock('../governance/competence.ts', () => ({
  holdsCapability: vi.fn(),
}));
vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reads are mocked; the handle is only passed through
const sql = {
  begin: (work: (tx: unknown) => unknown) => work('tx'),
} as unknown as Sql;

const caller = (role: string) => ({
  organizationId: 'org-1',
  userId: 'user-1',
  role,
});

function policy(orgWide: 'everyone' | 'editors' | 'admins' | null) {
  vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(
    orgWide === null ? null : { orgWide },
  );
}

beforeEach(() => {
  vi.mocked(readGovernancePolicyForOrg).mockReset();
  vi.mocked(holdsCapability).mockReset();
  vi.mocked(holdsCapability).mockResolvedValue(false);
  vi.mocked(createAuditLog).mockReset();
  vi.mocked(createAuditLog).mockResolvedValue(undefined as never);
});

describe('resolveSkillPublishing [SKILL-R7]', () => {
  it('leaves every member free to publish when the organization has no policy', async () => {
    policy(null);
    for (const role of ['owner', 'admin', 'developer', 'editor', 'member']) {
      expect(await resolveSkillPublishing(sql, caller(role))).toEqual({
        mode: 'everyone',
        allowed: true,
      });
    }
    expect(holdsCapability).not.toHaveBeenCalled();
    // Read the way an authorization policy must be.
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org-1',
      'skill_sharing',
      { strict: true },
    );
  });

  it.each([
    ['editors', 'developer', true],
    ['editors', 'editor', true],
    ['editors', 'member', false],
    ['admins', 'admin', true],
    ['admins', 'developer', false],
    ['admins', 'editor', false],
    ['admins', 'member', false],
  ] as const)('%s mode: a %s %s by role', async (mode, role, allowed) => {
    policy(mode);
    expect(await resolveSkillPublishing(sql, caller(role))).toEqual({
      mode,
      allowed,
    });
  });

  it('admits a member holding a live tale:skills.publish grant in a restricted mode', async () => {
    policy('admins');
    vi.mocked(holdsCapability).mockResolvedValue(true);
    expect(await resolveSkillPublishing(sql, caller('member'), 42)).toEqual({
      mode: 'admins',
      allowed: true,
    });
    expect(holdsCapability).toHaveBeenCalledWith(
      sql,
      'org-1',
      'user-1',
      'tale:skills.publish',
      42,
    );
  });

  it('never admits a disabled seat, whatever it holds', async () => {
    policy(null);
    vi.mocked(holdsCapability).mockResolvedValue(true);
    expect(
      (await resolveSkillPublishing(sql, caller('disabled'))).allowed,
    ).toBe(false);
  });

  it('reads a policy it cannot read as its tightest mode', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readGovernancePolicyForOrg).mockRejectedValue(
      new Error('GOVERNANCE_POLICY_INVALID'),
    );
    expect(await resolveSkillPublishing(sql, caller('editor'))).toEqual({
      mode: 'admins',
      allowed: false,
    });
    expect(await resolveSkillPublishing(sql, caller('owner'))).toEqual({
      mode: 'admins',
      allowed: true,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('maySkillPublishOrgWide [SKILL-R7]', () => {
  it('answers an owner or admin without reading the policy or the grants', async () => {
    for (const role of ['owner', 'admin']) {
      expect(await maySkillPublishOrgWide(sql, caller(role))).toBe(true);
    }
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
    expect(holdsCapability).not.toHaveBeenCalled();
  });

  it('answers anyone else as the policy and their grants decide', async () => {
    policy('editors');
    expect(await maySkillPublishOrgWide(sql, caller('editor'))).toBe(true);
    expect(await maySkillPublishOrgWide(sql, caller('member'))).toBe(false);
    vi.mocked(holdsCapability).mockResolvedValue(true);
    expect(await maySkillPublishOrgWide(sql, caller('member'))).toBe(true);
  });
});

describe('auditIfPublishRefused', () => {
  const refusal = new AppError({
    code: 'SKILL_PUBLISH_FORBIDDEN',
    message: 'reserved',
    data: { slug: 'house-voice' },
  });
  const actor = { id: 'user-1', email: 'ada@example.test', role: 'member' };

  it('names the skill the refusal carries', () => {
    expect(publishRefusalSlug(refusal)).toBe('house-voice');
    expect(
      publishRefusalSlug(
        new AppError({ code: 'SKILL_FORBIDDEN', message: 'x' }),
      ),
    ).toBeNull();
    expect(publishRefusalSlug(new Error('boom'))).toBeNull();
  });

  it('records a refused publish as denied, in its own transaction [SKILL-R7]', async () => {
    await auditIfPublishRefused(sql, refusal, {
      organizationId: 'org-1',
      actor,
      via: 'api',
    });
    expect(createAuditLog).toHaveBeenCalledExactlyOnceWith('tx', {
      organizationId: 'org-1',
      actorId: 'user-1',
      actorEmail: 'ada@example.test',
      actorRole: 'member',
      actorType: 'user',
      action: 'skill.publish_denied',
      category: 'skill',
      resourceType: 'skill',
      resourceId: 'house-voice',
      resourceName: 'house-voice',
      status: 'denied',
      errorMessage: 'organization-wide sharing is reserved',
      metadata: { via: 'api' },
    });
  });

  it('records nothing for any other failure', async () => {
    await auditIfPublishRefused(
      sql,
      new AppError({ code: 'TEAM_ACCESS_DENIED', message: 'x' }),
      { organizationId: 'org-1', actor, via: 'app' },
    );
    await auditIfPublishRefused(sql, new Error('disk on fire'), {
      organizationId: 'org-1',
      actor,
      via: 'app',
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('never turns the refusal into a failure of its own when the audit write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(createAuditLog).mockRejectedValue(new Error('chain locked'));
    await expect(
      auditIfPublishRefused(sql, refusal, {
        organizationId: 'org-1',
        actor,
        via: 'upload',
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
