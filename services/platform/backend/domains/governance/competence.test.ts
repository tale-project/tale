// @vitest-environment node

/**
 * The competence register's platform-capability half. The `tale:` namespace
 * is closed on grant: an unknown slug, whatever its case, is refused with
 * `COMPETENCE_CAPABILITY_UNKNOWN` and the refusal is audited the way a denied
 * grant is, while a known capability grants like any competence — and only
 * an admin grants it, so a member cannot delegate the right to itself.
 * `holdsCapability` vouches only for the one live, unexpired grant of the
 * asking organization's member.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CompetenceError,
  grantCompetence,
  holdsCapability,
  PLATFORM_CAPABILITIES,
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

describe('grantCompetence — the reserved capability namespace', () => {
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

describe('holdsCapability', () => {
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
