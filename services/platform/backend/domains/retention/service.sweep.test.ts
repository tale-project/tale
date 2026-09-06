// @vitest-environment node

/**
 * The custodian filter of the document and chat sweeps lives in SQL, on
 * every pass. Skipping held rows in JS after `LIMIT` starved the sweep: once
 * an org held more than a batch of trashed rows, the same held rows were
 * re-selected every night and the unheld rows behind them were never
 * reached — retention quietly under-deleted forever. The double reads the
 * statements the sweep issues (fragments inlined) and checks that the
 * filter is part of the candidate query, that a creator-less row stays a
 * candidate, and that what the query answers is what gets purged.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { releaseRefs } from '../knowledge/release.ts';
import { sweepOrgPhase2 } from './service.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
  resolveOrgSlug: vi.fn(() => Promise.resolve('acme')),
}));
vi.mock('../knowledge/release.ts', () => ({
  releaseRefs: vi.fn(() => Promise.resolve({ failures: [] })),
}));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../tts/service.ts', () => ({ cascadeDeleteThreadTtsChunks: vi.fn() }));

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');

interface Fragment {
  [FRAGMENT]: true;
  text: string;
  values: unknown[];
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/**
 * A recorder that inlines nested `sql\`…\`` fragments the way postgres.js
 * does, so the recorded text is the statement Postgres would see. Answers
 * the documents pass-B candidate query from the script; everything else
 * answers no rows.
 */
function fakeSweep(script: {
  documentsPassB: {
    id: string;
    fileRef: string | null;
    historyFiles: string[];
  }[];
  auditCandidates?: {
    id: string;
    actorId: string | null;
    resourceType: string;
    resourceId: string | null;
    ts: number;
  }[];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const rows =
      text.startsWith('SELECT id, file_ref') &&
      text.includes('FROM app.documents')
        ? script.documentsPassB
        : text.startsWith('SELECT id, actor_id') &&
            text.includes('FROM app.audit_logs')
          ? (script.auditCandidates ?? [])
          : [];
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
  };
  tag.begin = (callback: (tx: typeof tag) => unknown): unknown => callback(tag);
  tag.unsafe = (text: string): Fragment => ({
    [FRAGMENT]: true,
    text,
    values: [],
  });
  tag.json = (value: unknown): unknown => value;
  return { sql: tag as unknown as Sql, statements };
}

const org = {
  organizationId: 'org_1',
  config: {
    documentsEnabled: true,
    documentsRetentionDays: 30,
    chatHistoryEnabled: true,
    chatHistoryRetentionDays: 30,
    deletionGraceDays: 7,
  },
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('sweepOrgPhase2 — custodian holds', () => {
  it('filters held creators and owners in SQL on every pass, keeping creator-less rows as candidates', async () => {
    const fake = fakeSweep({ documentsPassB: [] });

    await sweepOrgPhase2(fake.sql, org, {
      orgHeld: false,
      userMembershipIds: new Set(['held-user']),
    });

    const documentsPassA = fake.statements.find(
      (s) =>
        s.text.startsWith(
          "UPDATE app.documents SET lifecycle_status = 'expired'",
        ) && s.text.includes('lifecycle_status IS NULL'),
    );
    const documentsPassB = fake.statements.find(
      (s) =>
        s.text.startsWith('SELECT id, file_ref') &&
        s.text.includes("lifecycle_status IN ('trashed', 'expired')"),
    );
    expect(documentsPassA?.text).toContain(
      'created_by IS NULL OR created_by <> ALL(?)',
    );
    expect(documentsPassB?.text).toContain(
      'created_by IS NULL OR created_by <> ALL(?)',
    );
    expect(documentsPassB?.values).toContainEqual(['held-user']);

    const chatPasses = fake.statements.filter(
      (s) =>
        s.text.includes('FROM app.thread_metadata tm') &&
        s.text.includes("tm.chat_type = 'chat'"),
    );
    expect(chatPasses).toHaveLength(2);
    for (const pass of chatPasses) {
      expect(pass.text).toContain('tm.user_id <> ALL(?)');
      expect(pass.values).toContainEqual(['held-user']);
    }
  });

  it('purges every candidate the query answers — the query is the filter', async () => {
    const fake = fakeSweep({
      documentsPassB: [
        { id: 'doc-unheld', fileRef: 's3:acme/unheld', historyFiles: [] },
      ],
    });

    const stats = await sweepOrgPhase2(fake.sql, org, {
      orgHeld: false,
      userMembershipIds: new Set(['held-user']),
    });

    expect(stats.documents).toBe(1);
    expect(releaseRefs).toHaveBeenCalledTimes(1);
    const purge = fake.statements.find(
      (s) => s.text === 'DELETE FROM app.documents WHERE id = ?',
    );
    expect(purge?.values).toEqual(['doc-unheld']);
  });
});

describe('sweepOrgPhase2 — sandbox provenance ledgers', () => {
  // Both tables are append-only per agent turn (tool calls carry the acting
  // user) and had no sweep at all; they ride the audit-log window because
  // that is what the writers call them and where the settle copies their
  // substance.
  const auditOrg = {
    organizationId: 'org_1',
    config: {
      auditLogEnabled: true,
      auditLogRetentionDays: 365,
      deletionGraceDays: 7,
    },
  };
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('deletes aged rows of both ledgers under the audit window, skipping held actors in SQL', async () => {
    const fake = fakeSweep({ documentsPassB: [] });
    const before = Date.now();

    await sweepOrgPhase2(fake.sql, auditOrg, {
      orgHeld: false,
      userMembershipIds: new Set(['held-user']),
    });

    const toolCalls = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.sandbox_tool_calls'),
    );
    expect(toolCalls?.text).toContain('WHERE org_id = ? AND created_at_ms < ?');
    expect(toolCalls?.text).toContain('user_id IS NULL OR user_id <> ALL(?)');
    expect(toolCalls?.values).toContainEqual(['held-user']);
    // The audit window carries no deletion grace: exactly days × DAY_MS.
    const cutoff = toolCalls?.values[1];
    expect(typeof cutoff).toBe('number');
    expect(cutoff as number).toBeGreaterThanOrEqual(before - 365 * DAY_MS);
    expect(cutoff as number).toBeLessThanOrEqual(Date.now() - 365 * DAY_MS);

    const credentials = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.sandbox_credential_access'),
    );
    expect(credentials?.text).toContain(
      'WHERE org_id = ? AND fetched_at_ms < ?',
    );
    expect(credentials?.values.slice(0, 2)).toEqual(['org_1', cutoff]);
  });

  it('leaves both ledgers alone when the audit-log category is off', async () => {
    const fake = fakeSweep({ documentsPassB: [] });

    await sweepOrgPhase2(
      fake.sql,
      { organizationId: 'org_1', config: { auditLogEnabled: false } },
      { orgHeld: false, userMembershipIds: new Set() },
    );

    expect(fake.statements.some((s) => s.text.includes('app.sandbox_'))).toBe(
      false,
    );
  });
});

describe('sweepOrgPhase2 — audit-log prefix walk under a custodian hold', () => {
  // The chain is prefix-only: the walk deletes oldest-first and stops at the
  // first row a held custodian owns. A custodian owns a row when they acted
  // (actor_id) AND when they were acted upon (resource_type 'user',
  // resource_id) — the same two-sided definition the erasure scrub uses —
  // so the rows recording what was done TO the custodian (a role change,
  // an erasure denial, the hold itself) survive the window too.
  const auditOrg = {
    organizationId: 'org_1',
    config: {
      auditLogEnabled: true,
      auditLogRetentionDays: 365,
      deletionGraceDays: 0,
    },
  };

  it('stops at a row ABOUT the held user, not only at one BY them', async () => {
    const fake = fakeSweep({
      documentsPassB: [],
      auditCandidates: [
        {
          id: 'a1',
          actorId: 'other',
          resourceType: 'document',
          resourceId: 'd1',
          ts: 1,
        },
        {
          id: 'a2',
          actorId: 'admin',
          resourceType: 'user',
          resourceId: 'held-user',
          ts: 2,
        },
        {
          id: 'a3',
          actorId: 'other',
          resourceType: 'document',
          resourceId: 'd2',
          ts: 3,
        },
      ],
    });

    const stats = await sweepOrgPhase2(fake.sql, auditOrg, {
      orgHeld: false,
      userMembershipIds: new Set(['held-user']),
    });

    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.audit_logs'),
    );
    // `sql(prefix)` is a fragment, so the ids land inline in the text.
    expect(purge?.text).toBe(
      'DELETE FROM app.audit_logs WHERE id IN a1 RETURNING id',
    );
    expect(stats.auditLogs).toBe(0); // the fake answers no rows to the DELETE
  });

  it('still stops at a row BY the held user', async () => {
    const fake = fakeSweep({
      documentsPassB: [],
      auditCandidates: [
        {
          id: 'a1',
          actorId: 'other',
          resourceType: 'document',
          resourceId: null,
          ts: 1,
        },
        {
          id: 'a2',
          actorId: 'held-user',
          resourceType: 'document',
          resourceId: null,
          ts: 2,
        },
      ],
    });

    await sweepOrgPhase2(fake.sql, auditOrg, {
      orgHeld: false,
      userMembershipIds: new Set(['held-user']),
    });

    const purge = fake.statements.find((s) =>
      s.text.startsWith('DELETE FROM app.audit_logs'),
    );
    expect(purge?.text).toBe(
      'DELETE FROM app.audit_logs WHERE id IN a1 RETURNING id',
    );
  });
});
