// @vitest-environment node

/**
 * One operation, one approval. The gate's read-then-insert cannot lock what
 * is not there (FOR UPDATE over zero rows), so two evaluations racing for
 * one operation both reached the insert and minted twin pending cards — the
 * gate re-reads the NEWEST, so the older twin stayed pending forever. The
 * insert is now a claim against the partial unique index (0074) and the
 * loser answers with the winner's card. The real-Postgres race rides the
 * integration check; this double locks the statement shape and the lost-
 * claim path.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import { evaluateApprovalGate } from './gate.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn(() => Promise.resolve(null)),
}));

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted transaction: record reads pop `records`, the insert pops
 * `inserts`; everything else answers no rows. */
function fakeGate(script: {
  records: { id: string; status: string; metadata: unknown }[][];
  inserts: { id: string }[][];
}): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT id, status, metadata FROM app.approvals')) {
      return Promise.resolve(script.records.shift() ?? []);
    }
    if (text.startsWith('INSERT INTO app.approvals')) {
      return Promise.resolve(script.inserts.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  tx.json = (value: unknown): unknown => value;
  const sql = {
    begin: (callback: (t: typeof tx) => unknown): unknown => callback(tx),
  } as unknown as Sql;
  return { sql, statements };
}

const args = {
  organizationId: 'org_1',
  source: 'connector' as const,
  resourceKey: 'op-1',
  connector: 'imap-smtp',
  action: 'send',
  effect: 'write' as const,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('evaluateApprovalGate', () => {
  it('claims the pending row with an ON CONFLICT insert and answers with it', async () => {
    const fake = fakeGate({ records: [[]], inserts: [[{ id: 'a-1' }]] });

    const decision = await evaluateApprovalGate(fake.sql, args);

    expect(decision).toEqual({ decision: 'needs-approval', approvalId: 'a-1' });
    expect(readGovernancePolicyForOrg).toHaveBeenCalledTimes(1);
    const insert = fake.statements.find((s) =>
      s.text.startsWith('INSERT INTO app.approvals'),
    );
    expect(insert?.text).toContain(
      "ON CONFLICT (org_id, resource_type, resource_id) WHERE resource_type = 'connector_operation' AND status = 'pending' DO NOTHING",
    );
    expect(insert?.text).toContain('RETURNING id');
  });

  it('answers with the winner card when a concurrent evaluation claimed the operation first', async () => {
    const fake = fakeGate({
      // Empty on the first read; the winner's committed row on the re-read.
      records: [[], [{ id: 'a-winner', status: 'pending', metadata: null }]],
      // The insert conflicted — no row back.
      inserts: [[]],
    });

    const decision = await evaluateApprovalGate(fake.sql, args);

    expect(decision).toEqual({
      decision: 'needs-approval',
      approvalId: 'a-winner',
    });
    const reads = fake.statements.filter((s) =>
      s.text.startsWith('SELECT id, status, metadata FROM app.approvals'),
    );
    expect(reads).toHaveLength(2);
    for (const read of reads) expect(read.text).toContain('FOR UPDATE');
  });

  it('keeps answering a re-entry from the record on file without a new insert', async () => {
    const fake = fakeGate({
      records: [[{ id: 'a-1', status: 'pending', metadata: null }]],
      inserts: [],
    });

    const decision = await evaluateApprovalGate(fake.sql, args);

    expect(decision).toEqual({ decision: 'needs-approval', approvalId: 'a-1' });
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
    expect(
      fake.statements.some((s) =>
        s.text.startsWith('INSERT INTO app.approvals'),
      ),
    ).toBe(false);
  });

  it('answers a policy-only ask from the policy alone — no record read, no card minted', async () => {
    // A caller that cannot park (a subautomation's node) must not leave a
    // pending card nothing would consume, nor inherit a same-key record.
    const fake = fakeGate({
      records: [[{ id: 'a-parent', status: 'executing', metadata: null }]],
      inserts: [[{ id: 'never' }]],
    });

    const decision = await evaluateApprovalGate(fake.sql, {
      ...args,
      policyOnly: true,
    });

    // The default policy: an outbound write needs a person.
    expect(decision).toEqual({ decision: 'needs-approval' });
    expect(readGovernancePolicyForOrg).toHaveBeenCalledTimes(1);
    expect(fake.statements).toEqual([]);
  });

  it('consumes an approved record to completed on its first pass through', async () => {
    const fake = fakeGate({
      records: [[{ id: 'a-1', status: 'executing', metadata: null }]],
      inserts: [],
    });

    const decision = await evaluateApprovalGate(fake.sql, args);

    expect(decision).toEqual({ decision: 'allow', approvalId: 'a-1' });
    const update = fake.statements.find((s) =>
      s.text.startsWith('UPDATE app.approvals'),
    );
    expect(update?.text).toContain("SET status = 'completed'");
  });
});
