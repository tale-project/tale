// @vitest-environment node

/**
 * The competence register's platform-capability half. The `tale:` namespace
 * is closed on grant: an unknown slug, whatever its case, is refused with
 * `COMPETENCE_CAPABILITY_UNKNOWN` and the refusal is audited the way a denied
 * grant is, while a known capability grants like any competence — and only
 * an admin grants it, so a member cannot delegate the right to itself.
 * `holdsCapability` vouches only for the one live, unexpired grant of the
 * asking organization's member. `updateCompetence` changes an active grant's
 * expiry and evidence in place, audited without the evidence text.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CompetenceError,
  grantCompetence,
  holdsCapability,
  PLATFORM_CAPABILITIES,
  updateCompetence,
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
 * callback on the same double. */
function fakeSql(answer: (text: string) => object[] | undefined): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    return Promise.resolve(answer(text) ?? []);
  };
  const begin = (callback: (tx: unknown) => Promise<unknown>) => callback(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: Object.assign(tag, { begin }) as unknown as Sql, queries };
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

  it('reads the one unrevoked grant of this organization’s member', async () => {
    const { holds, queries } = await read([
      { expiresAt: null, revokedAt: null },
    ]);
    expect(holds).toBe(true);
    expect(queries).toHaveLength(1);
    const [query] = queries;
    expect(query?.text).toContain(
      'FROM app.competence_records WHERE org_id = $? AND user_id = $? AND competence = $? AND revoked_at_ms IS NULL LIMIT 1',
    );
    expect(query?.values).toEqual([
      'org-1',
      'u-1',
      'tale:notifications.export',
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

describe('updateCompetence — an active grant changed in place [GOV-R18]', () => {
  const DAY = 24 * 60 * 60 * 1000;

  /** The locked record `record-1` as `row` describes it. */
  function lockedRecord(row: object) {
    return (text: string): object[] | undefined =>
      text.includes('FROM app.competence_records') &&
      text.includes('FOR UPDATE')
        ? [
            {
              competence: 'tale:rest.act-as',
              userId: 'u-1',
              expiresAt: null,
              revokedAt: null,
              evidence: null,
              ...row,
            },
          ]
        : undefined;
  }

  it('changes the expiry and the evidence, and audits the old and new expiry without the evidence', async () => {
    const before = Date.now() + DAY;
    const after = Date.now() + 30 * DAY;
    const { sql, queries } = fakeSql(
      lockedRecord({ expiresAt: before, evidence: 'Course 2025' }),
    );
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: { ...ADMIN, email: 'ada@example.com' },
        recordId: 'record-1',
        expiresAt: after,
        evidence: '  Course 2026  ',
      }),
    ).resolves.toEqual({ changed: true });
    const update = queries.find((query) =>
      query.text.startsWith('UPDATE app.competence_records'),
    );
    expect(update?.values).toEqual([after, 'Course 2026', 'record-1']);
    expect(queries[0]?.values).toEqual(['record-1', 'org-1']);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      actorId: 'admin-1',
      actorEmail: 'ada@example.com',
      actorType: 'user',
      action: 'competence_updated',
      category: 'security',
      resourceType: 'competence_record',
      resourceId: 'record-1',
      resourceName: 'tale:rest.act-as',
      status: 'success',
      previousState: { userId: 'u-1', expiresAt: before },
      newState: { userId: 'u-1', expiresAt: after },
      changedFields: ['expiresAt', 'evidence'],
    });
    expect(JSON.stringify(createAuditLog.mock.calls)).not.toContain('Course');
  });

  it('makes a grant open-ended and clears its evidence', async () => {
    const before = Date.now() + DAY;
    const { sql, queries } = fakeSql(
      lockedRecord({ expiresAt: before, evidence: 'Course 2025' }),
    );
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        recordId: 'record-1',
        expiresAt: null,
        evidence: '   ',
      }),
    ).resolves.toEqual({ changed: true });
    expect(
      queries.find((query) =>
        query.text.startsWith('UPDATE app.competence_records'),
      )?.values,
    ).toEqual([null, null, 'record-1']);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        previousState: { userId: 'u-1', expiresAt: before },
        newState: { userId: 'u-1', expiresAt: null },
        changedFields: ['expiresAt', 'evidence'],
      }),
    );
  });

  it('keeps a field it is not given, and names only what changed', async () => {
    const before = Date.now() + DAY;
    const { sql, queries } = fakeSql(
      lockedRecord({ expiresAt: before, evidence: 'Course 2025' }),
    );
    await updateCompetence(sql, {
      organizationId: 'org-1',
      actor: ADMIN,
      recordId: 'record-1',
      evidence: 'Course 2026',
    });
    expect(
      queries.find((query) =>
        query.text.startsWith('UPDATE app.competence_records'),
      )?.values,
    ).toEqual([before, 'Course 2026', 'record-1']);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        previousState: { userId: 'u-1', expiresAt: before },
        newState: { userId: 'u-1', expiresAt: before },
        changedFields: ['evidence'],
      }),
    );
  });

  it('writes and audits nothing when nothing changes', async () => {
    const before = Date.now() + DAY;
    const { sql, queries } = fakeSql(
      lockedRecord({ expiresAt: before, evidence: 'Course 2025' }),
    );
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        recordId: 'record-1',
        expiresAt: before,
        evidence: 'Course 2025',
      }),
    ).resolves.toEqual({ changed: false });
    expect(
      queries.some((query) =>
        query.text.startsWith('UPDATE app.competence_records'),
      ),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a non-admin before reading the record, and audits the refusal', async () => {
    const { sql, queries } = fakeSql(lockedRecord({}));
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: { userId: 'u-1', role: 'developer' },
        recordId: 'record-1',
        expiresAt: null,
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_FORBIDDEN', status: 403 });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'competence_update_denied',
        resourceId: 'record-1',
        status: 'failure',
        errorMessage: 'admin role required',
      }),
    );
    expect(queries).toEqual([]);
  });

  it.each([
    [
      'a revoked grant',
      { revokedAt: Date.now() - DAY },
      'COMPETENCE_ALREADY_REVOKED',
      409,
    ],
    [
      'an expired grant',
      { expiresAt: Date.now() - DAY },
      'COMPETENCE_EXPIRED',
      409,
    ],
  ])('refuses to change %s', async (_label, row, code, status) => {
    const { sql, queries } = fakeSql(lockedRecord(row));
    const failure = updateCompetence(sql, {
      organizationId: 'org-1',
      actor: ADMIN,
      recordId: 'record-1',
      expiresAt: Date.now() + DAY,
    });
    await expect(failure).rejects.toBeInstanceOf(CompetenceError);
    await expect(failure).rejects.toMatchObject({ code, status });
    expect(
      queries.some((query) =>
        query.text.startsWith('UPDATE app.competence_records'),
      ),
    ).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('refuses a record of another organization as unknown', async () => {
    const { sql } = fakeSql(() => undefined);
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-2',
        actor: ADMIN,
        recordId: 'record-1',
        evidence: 'x',
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_NOT_FOUND', status: 404 });
  });

  it('refuses an expiry in the past and evidence over the cap before reading the record', async () => {
    const { sql, queries } = fakeSql(lockedRecord({}));
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        recordId: 'record-1',
        expiresAt: Date.now() - 1000,
      }),
    ).rejects.toMatchObject({ code: 'COMPETENCE_EXPIRY_IN_PAST', status: 400 });
    await expect(
      updateCompetence(sql, {
        organizationId: 'org-1',
        actor: ADMIN,
        recordId: 'record-1',
        evidence: 'x'.repeat(2001),
      }),
    ).rejects.toMatchObject({
      code: 'COMPETENCE_EVIDENCE_TOO_LONG',
      status: 400,
    });
    expect(queries).toEqual([]);
  });
});
