// @vitest-environment node

/**
 * The competence register's platform-capability half. The `tale:` namespace
 * is closed on grant: an unknown slug, whatever its case, is refused with
 * `COMPETENCE_CAPABILITY_UNKNOWN` and the refusal is audited the way a denied
 * grant is, while a known capability grants like any competence — and only
 * an admin grants it, so a member cannot delegate the right to itself.
 * `holdsCapability` vouches only for a live, unexpired grant of the asking
 * organization's member — their own, or one of a team an admin added them
 * to. A team holds a platform capability only, never a qualification, and
 * never while an identity provider syncs its roster.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CompetenceError,
  grantCompetence,
  holdsCapability,
  listRecordsVouchingFor,
  PLATFORM_CAPABILITIES,
  revokeCompetence,
} from './competence.ts';

const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit-1'),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

interface Captured {
  text: string;
  values: unknown[];
}

/** Tagged-template Sql double answering a read by its text; `begin` runs the
 * callback on the same double. A template that is no statement (a condition
 * such as `vouchesForUser`) is a fragment the enclosing statement binds, and
 * `unsafe` text (the column list) is a value it splices in. */
function fakeSql(answer: (text: string) => object[] | undefined): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (!/^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/.test(text)) {
      return { fragment: text, values };
    }
    queries.push({ text, values });
    return Promise.resolve(answer(text) ?? []);
  };
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tag);
  const unsafe = (text: string) => ({
    unsafe: text.replace(/\s+/g, ' ').trim(),
  });
  const double = Object.assign(tag, { begin, unsafe });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: double as unknown as Sql, queries };
}

/** The register's writes for a member of `org-1`. */
function register(text: string): object[] | undefined {
  if (text.includes('FROM "member"')) {
    return [
      { id: 'm-1', organizationId: 'org-1', userId: 'u-1', role: 'developer' },
    ];
  }
  if (text.startsWith('INSERT INTO app.competence_records')) {
    return [{ id: 'record-1' }];
  }
  return undefined;
}

const ADMIN = { userId: 'admin-1', role: 'admin' };

beforeEach(() => {
  createAuditLog.mockClear();
});

describe('grantCompetence — the reserved capability namespace [GOV-R12]', () => {
  it.each([
    'tale:notifications.exports',
    'tale:admin',
    'TALE:notifications.export',
    '  Tale:Notifications.Export  ',
  ])(
    'refuses %j as an unknown platform capability, audited, before any write',
    async (competence) => {
      const { sql, queries } = fakeSql(register);
      const refusal = grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        userId: 'u-1',
        competence,
      });
      await expect(refusal).rejects.toBeInstanceOf(CompetenceError);
      await expect(refusal).rejects.toMatchObject({
        code: 'COMPETENCE_CAPABILITY_UNKNOWN',
        status: 400,
        // The refusal names what the namespace does carry.
        message: expect.stringContaining(PLATFORM_CAPABILITIES.join(', ')),
      });
      expect(createAuditLog).toHaveBeenCalledTimes(1);
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'admin-1',
          action: 'competence_grant_denied',
          category: 'security',
          resourceType: 'competence_record',
          resourceName: competence.trim(),
          status: 'failure',
          errorMessage: 'unknown platform capability',
        }),
      );
      // Refused before the transaction: no membership read, no record.
      expect(queries).toEqual([]);
    },
  );

  it.each([...PLATFORM_CAPABILITIES, 'iso-13485-auditor', 'talent:recruiting'])(
    'grants %j like any competence, audited as granted',
    async (competence) => {
      const { sql, queries } = fakeSql(register);
      await expect(
        grantCompetence(sql, {
          organizationId: 'org-1',
          actor: ADMIN,
          userId: 'u-1',
          competence,
        }),
      ).resolves.toEqual({ recordId: 'record-1' });
      const insert = queries.find((q) =>
        q.text.startsWith('INSERT INTO app.competence_records'),
      );
      expect(insert?.values).toContain(competence);
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'competence_granted',
          resourceName: competence,
          status: 'success',
        }),
      );
    },
  );

  it('refuses a non-admin before judging the slug, so no member grants itself a capability', async () => {
    const { sql, queries } = fakeSql(register);
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: { userId: 'u-1', role: 'developer' },
        userId: 'u-1',
        competence: 'tale:notifications.export',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_FORBIDDEN', status: 403 });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_grant_denied',
        errorMessage: 'admin role required',
      }),
    );
    expect(queries).toEqual([]);
  });
});

describe('holdsCapability [GOV-R13]', () => {
  const NOW = 1_800_000_000_000;
  const read = async (rows: object[]) => {
    const { sql, queries } = fakeSql((text) =>
      text.includes('FROM app.competence_records') ? rows : undefined,
    );
    const holds = await holdsCapability(
      sql,
      'org-1',
      'u-1',
      'tale:notifications.export',
      NOW,
    );
    return { holds, queries };
  };

  it('reads a live grant of this organization’s member, their own or their team’s', async () => {
    const { holds, queries } = await read([
      { expiresAt: null, revokedAt: null },
    ]);
    expect(holds).toBe(true);
    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query?.text).toContain(
      'FROM app.competence_records c WHERE c.org_id = $? AND c.competence = $? AND c.revoked_at_ms IS NULL AND (c.expires_at_ms IS NULL OR c.expires_at_ms > $?) AND $? LIMIT 1',
    );
    expect(query?.values).toEqual([
      'org-1',
      'tale:notifications.export',
      NOW,
      // `vouchesForUser`: the member's own grant, or a grant of a team they
      // belong to through a membership an admin made [GOV-R20].
      {
        fragment: expect.stringMatching(
          /^\( c\.user_id = \$\? OR \(c\.team_id IS NOT NULL AND EXISTS \( SELECT 1 FROM "teamMember" tm JOIN app\.admin_added_team_members a ON a\.team_member_id = tm\."id" WHERE tm\."teamId" = c\.team_id AND tm\."userId" = \$\? AND a\.org_id = c\.org_id \)\) \)$/,
        ),
        values: ['u-1', 'u-1'],
      },
    ]);
  });

  it('vouches until the expiry, and never without a live grant', async () => {
    expect((await read([{ expiresAt: NOW + 1, revokedAt: null }])).holds).toBe(
      true,
    );
    expect((await read([{ expiresAt: NOW, revokedAt: null }])).holds).toBe(
      false,
    );
    expect((await read([])).holds).toBe(false);
    // A revoked row never vouches, should one ever reach the check.
    expect((await read([{ expiresAt: null, revokedAt: NOW - 1 }])).holds).toBe(
      false,
    );
  });
});

/** The register's answers for a team of `org-1`: `team` is what the team
 * read finds (none: no such team in the organization). */
function teamRegister(
  team: { name: string; synced: boolean } | undefined,
  inserted = true,
) {
  return (text: string): object[] | undefined => {
    if (text.startsWith('SELECT t."name"')) return team ? [team] : [];
    if (text.startsWith('INSERT INTO app.competence_records')) {
      return inserted ? [{ id: 'record-7' }] : [];
    }
    return undefined;
  };
}

describe('grantCompetence — a team holds a platform capability [GOV-R19]', () => {
  it('grants it to the team, locked against its deletion, and audits the grant per team', async () => {
    const { sql, queries } = fakeSql(
      teamRegister({ name: 'Platform', synced: false }),
    );
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        teamId: 'team-7',
        competence: 'tale:models.api',
        evidence: 'the platform team runs the model gateway',
      }),
    ).resolves.toEqual({ recordId: 'record-7' });
    // No member read: the team is the holder.
    expect(queries.some((q) => q.text.includes('FROM "member"'))).toBe(false);
    const teamRead = queries.find((q) => q.text.startsWith('SELECT t."name"'));
    expect(teamRead?.text).toContain(
      'FROM "team" t WHERE t."id" = $? AND t."organizationId" = $? FOR SHARE OF t',
    );
    expect(teamRead?.values).toEqual([
      // The synced test (`teamIsSyncedSql`), bound into the read.
      {
        fragment: expect.stringContaining('app.sso_provisioning_links'),
        values: [],
      },
      'team-7',
      'org-1',
    ]);
    // A re-grant after expiry retires the team's expired row, not a member's.
    const retire = queries.find((q) => q.text.startsWith('UPDATE'));
    expect(retire?.values).toContainEqual({
      fragment: 'team_id = $?',
      values: ['team-7'],
    });
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.competence_records'),
    );
    expect(insert?.text).toContain(
      'org_id, user_id, team_id, competence, granted_by',
    );
    expect(insert?.values.slice(0, 5)).toEqual([
      'org-1',
      null,
      'team-7',
      'tale:models.api',
      'admin-1',
    ]);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_granted',
        resourceId: 'record-7',
        resourceName: 'tale:models.api',
        newState: {
          teamId: 'team-7',
          teamName: 'Platform',
          competence: 'tale:models.api',
          grantedBy: 'admin-1',
        },
      }),
    );
  });

  it.each(['iso-13485-auditor', 'tax-reviewer'])(
    'refuses the qualification %j for a team before any read',
    async (competence) => {
      const { sql, queries } = fakeSql(
        teamRegister({ name: 'Platform', synced: false }),
      );
      await expect(
        grantCompetence(sql, {
          organizationId: 'org-1',
          actor: ADMIN,
          teamId: 'team-7',
          competence,
        }),
      ).rejects.toMatchObject({
        code: 'COMPETENCE_TEAM_CAPABILITY_ONLY',
        status: 400,
      });
      expect(queries).toEqual([]);
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it('refuses a team an identity provider syncs, and writes nothing', async () => {
    const { sql, queries } = fakeSql(
      teamRegister({ name: 'Department.Platform', synced: true }),
    );
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        teamId: 'team-7',
        competence: 'tale:models.api',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_TEAM_SYNCED', status: 409 });
    expect(queries.map((q) => q.text.split(' ')[0])).toEqual(['SELECT']);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a team this organization does not have', async () => {
    const { sql, queries } = fakeSql(teamRegister(undefined));
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        teamId: 'team-of-org-2',
        competence: 'tale:models.api',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_TEAM_NOT_FOUND', status: 404 });
    expect(queries.map((q) => q.text.split(' ')[0])).toEqual(['SELECT']);
  });

  it('refuses a second live grant of the competence to the team', async () => {
    const { sql } = fakeSql(
      teamRegister({ name: 'Platform', synced: false }, false),
    );
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        teamId: 'team-7',
        competence: 'tale:models.api',
      }),
    ).rejects.toMatchObject({
      code: 'COMPETENCE_ALREADY_GRANTED',
      status: 409,
      message: expect.stringContaining('this team already holds'),
    });
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a non-admin, audited, before reading the team', async () => {
    const { sql, queries } = fakeSql(
      teamRegister({ name: 'Platform', synced: false }),
    );
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: { userId: 'u-1', role: 'member' },
        teamId: 'team-7',
        competence: 'tale:models.api',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_FORBIDDEN', status: 403 });
    expect(queries).toEqual([]);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'competence_grant_denied' }),
    );
  });
});

describe('revokeCompetence — a team grant [GOV-R19]', () => {
  it('revokes it and audits the revocation per team', async () => {
    const { sql, queries } = fakeSql((text) => {
      if (text.startsWith('SELECT competence')) {
        return [
          {
            competence: 'tale:models.api',
            userId: null,
            teamId: 'team-7',
            revokedAt: null,
          },
        ];
      }
      if (text.startsWith('SELECT "name" FROM "team"')) {
        return [{ name: 'Platform' }];
      }
      return undefined;
    });
    await revokeCompetence(sql, {
      organizationId: 'org-1',
      actor: ADMIN,
      recordId: 'record-7',
    });
    expect(queries.some((q) => q.text.startsWith('UPDATE'))).toBe(true);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_revoked',
        resourceId: 'record-7',
        resourceName: 'tale:models.api',
        newState: {
          teamId: 'team-7',
          teamName: 'Platform',
          revokedBy: 'admin-1',
        },
      }),
    );
  });

  it('still names the team by id once the team is gone', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith('SELECT competence')
        ? [
            {
              competence: 'tale:models.api',
              userId: null,
              teamId: 'team-7',
              revokedAt: null,
            },
          ]
        : undefined,
    );
    await revokeCompetence(sql, {
      organizationId: 'org-1',
      actor: ADMIN,
      recordId: 'record-7',
    });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        newState: { teamId: 'team-7', teamName: null, revokedBy: 'admin-1' },
      }),
    );
  });
});

describe('the writes a right’s switch makes in Settings › Members [GOV-R21]', () => {
  it('grants with an end date, and audits the grant with it', async () => {
    const expiresAt = Date.now() + 30 * 86_400_000;
    const { sql, queries } = fakeSql(register);
    await expect(
      grantCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        userId: 'u-1',
        competence: 'tale:rest.act-as',
        expiresAt,
      }),
    ).resolves.toEqual({ recordId: 'record-1' });
    const insert = queries.find((query) =>
      query.text.startsWith('INSERT INTO app.competence_records'),
    );
    expect(insert?.values).toEqual(
      expect.arrayContaining(['u-1', 'tale:rest.act-as', expiresAt]),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_granted',
        category: 'security',
        resourceId: 'record-1',
        resourceName: 'tale:rest.act-as',
        newState: {
          userId: 'u-1',
          competence: 'tale:rest.act-as',
          grantedBy: 'admin-1',
          expiresAt,
        },
      }),
    );
  });

  it('revokes the live grant, and audits who revoked it', async () => {
    const { sql, queries } = fakeSql((text) =>
      text.includes('FOR UPDATE')
        ? [
            {
              competence: 'tale:rest.act-as',
              userId: 'u-1',
              teamId: null,
              revokedAt: null,
            },
          ]
        : undefined,
    );
    await revokeCompetence(sql, {
      organizationId: 'org-1',
      actor: ADMIN,
      recordId: 'record-1',
    });
    expect(
      queries.some((query) =>
        query.text.startsWith(
          'UPDATE app.competence_records SET revoked_at_ms',
        ),
      ),
    ).toBe(true);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_revoked',
        resourceId: 'record-1',
        resourceName: 'tale:rest.act-as',
        status: 'success',
        newState: { userId: 'u-1', revokedBy: 'admin-1' },
      }),
    );
  });

  it('refuses a non-admin’s revocation before reading the register, and audits the refusal', async () => {
    const { sql, queries } = fakeSql(register);
    await expect(
      revokeCompetence(sql, {
        organizationId: 'org-1',
        actor: { userId: 'u-1', role: 'member' },
        recordId: 'record-1',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_FORBIDDEN', status: 403 });
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_revoke_denied',
        resourceId: 'record-1',
        errorMessage: 'admin role required',
      }),
    );
    expect(queries).toEqual([]);
  });
});

describe('listRecordsVouchingFor [GOV-R21]', () => {
  it('lists the member’s unrevoked records by the rule holdsCapability reads: their own, and their teams’', async () => {
    const rows = [{ id: 'record-1' }];
    const { sql, queries } = fakeSql((text) =>
      text.includes('FROM app.competence_records') ? rows : undefined,
    );
    await expect(listRecordsVouchingFor(sql, 'org-1', 'u-1')).resolves.toBe(
      rows,
    );
    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query?.text).toBe(
      'SELECT $? FROM app.competence_records WHERE id IN ( SELECT c.id FROM app.competence_records c WHERE c.org_id = $? AND c.revoked_at_ms IS NULL AND $? ) ORDER BY granted_at_ms DESC',
    );
    expect(query?.values).toEqual([
      { unsafe: expect.stringContaining('team_id AS "teamId"') },
      'org-1',
      {
        fragment: expect.stringMatching(
          /^\( c\.user_id = \$\? OR \(c\.team_id IS NOT NULL AND EXISTS .* JOIN app\.admin_added_team_members a .*\)$/,
        ),
        values: ['u-1', 'u-1'],
      },
    ]);
  });
});
