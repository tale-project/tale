import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAuditLog,
  emitHintInTx,
  readGovernancePolicyForOrg,
  resolveOrgSlug,
  writeGovernancePolicyFile,
} = vi.hoisted(() => ({
  createAuditLog: vi.fn(),
  emitHintInTx: vi.fn(),
  readGovernancePolicyForOrg: vi.fn(),
  resolveOrgSlug: vi.fn(),
  writeGovernancePolicyFile: vi.fn(),
}));

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg,
  resolveOrgSlug,
}));
vi.mock('../../lib/governance-policy-write.ts', () => ({
  writeGovernancePolicyFile,
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx }));

import { RETENTION_POLICY_FIELD_BY_CATEGORY } from '../../core/governance/retention_floors.ts';
import {
  cancelPendingDsarPolicyChange,
  cancelPendingRetentionChange,
  detectRetentionShortening,
  getDsarPolicyForUi,
  GovernanceTailError,
  proposeDsarPolicy,
} from './settings-tail.ts';

interface Statement {
  text: string;
  values: unknown[];
  /** Whether it ran inside `begin`. */
  inTransaction: boolean;
}

/** A fake `sql` answering by statement shape; `begin` runs its callback on
 * the same tag so pool and transaction statements land in one ledger. */
function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  let inTransaction = false;
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = { text: strings.join('?'), values, inTransaction };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.unsafe = (text: string) => text;
  tag.json = (value: unknown) => ({ json: value });
  tag.begin = async (fn: (tx: unknown) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await fn(tag);
    } finally {
      inTransaction = false;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the tail functions exercise exactly the tag, unsafe, json, and begin surfaces faked here
  return { sql: tag as unknown as Sql, statements };
}

const AUTH = { organizationId: 'org_1', userId: 'user_1' };
const PENDING_ROW = {
  id: 'pending_1',
  appliesAt: Date.now() + 60 * 60 * 1000,
  oldConfig: { chatHistoryRetentionDays: 30 },
  newConfig: { chatHistoryRetentionDays: 7 },
  requestedBy: 'user_1',
  requestedAt: Date.now() - 1000,
  summary: 'Reduced: chat history (30 → 7)',
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveOrgSlug.mockResolvedValue('acme');
  readGovernancePolicyForOrg.mockResolvedValue(null);
  createAuditLog.mockResolvedValue(undefined);
  emitHintInTx.mockResolvedValue(undefined);
  writeGovernancePolicyFile.mockResolvedValue(undefined);
});

describe('cancelPendingRetentionChange — write order', () => {
  it('drops the pending row and audits BEFORE reverting the file, all in one transaction', async () => {
    const { sql, statements } = fakeSql((statement) =>
      statement.text.includes('FROM app.retention_policy_pending_changes')
        ? [PENDING_ROW]
        : [],
    );

    await cancelPendingRetentionChange(sql, AUTH);

    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'retention_policy',
      PENDING_ROW.oldConfig,
    );
    const auditAt = createAuditLog.mock.invocationCallOrder[0] ?? Infinity;
    const writeAt = writeGovernancePolicyFile.mock.invocationCallOrder[0] ?? 0;
    expect(auditAt).toBeLessThan(writeAt);
    expect(
      statements.some((s) =>
        s.text.includes('DELETE FROM app.retention_policy_pending_changes'),
      ),
    ).toBe(true);
  });

  it('keeps the file as it is when the transaction fails — no cancel on disk with the shortening still staged', async () => {
    const { sql } = fakeSql((statement) =>
      statement.text.includes('FROM app.retention_policy_pending_changes')
        ? [PENDING_ROW]
        : [],
    );
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));

    await expect(cancelPendingRetentionChange(sql, AUTH)).rejects.toThrow(
      'audit chain unavailable',
    );
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });
});

describe('proposeDsarPolicy — a tightening', () => {
  const TIGHTER = {
    coolingOffHours: 48,
    requireDualApproval: true,
    dailyLimitPerAdmin: 5,
  };

  it('audits what the file held (read fresh) and writes the file last, inside the transaction', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      coolingOffHours: 24,
      requireDualApproval: false,
      dailyLimitPerAdmin: 10,
    });
    const { sql } = fakeSql(() => []);

    const outcome = await proposeDsarPolicy(sql, AUTH, TIGHTER);

    expect(outcome).toEqual({ staged: false });
    expect(readGovernancePolicyForOrg).toHaveBeenCalledWith(
      sql,
      'org_1',
      'dsar_governance',
      { fresh: true },
    );
    const auditAt = createAuditLog.mock.invocationCallOrder[0] ?? Infinity;
    const writeAt = writeGovernancePolicyFile.mock.invocationCallOrder[0] ?? 0;
    expect(auditAt).toBeLessThan(writeAt);
    expect(writeGovernancePolicyFile).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      'dsar_governance',
      TIGHTER,
    );
  });

  it('never writes the file when the audit row fails', async () => {
    const { sql } = fakeSql(() => []);
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));

    await expect(proposeDsarPolicy(sql, AUTH, TIGHTER)).rejects.toThrow(
      'audit chain unavailable',
    );
    expect(writeGovernancePolicyFile).not.toHaveBeenCalled();
  });
});

describe('cancelPendingDsarPolicyChange — any admin can cancel a staged weakening [GOV-R24]', () => {
  const ADMIN = {
    organizationId: 'org_1',
    userId: 'admin_1',
    email: 'mia@example.test',
  };
  const isCancel = (statement: Statement) =>
    statement.text.includes('DELETE FROM app.dsar_policy_pending_changes');

  it('drops a change still inside its grace and audits the admin who cancelled it, in one transaction', async () => {
    const { sql, statements } = fakeSql((statement) =>
      isCancel(statement) ? [{ id: 'dsar_pending_1' }] : [],
    );
    const before = Date.now();

    await cancelPendingDsarPolicyChange(sql, ADMIN);

    // One statement, the grace-bounded DELETE, run in the transaction.
    expect(statements).toEqual([
      expect.objectContaining({
        inTransaction: true,
        values: ['org_1', expect.any(Number)],
      }),
    ]);
    const [cancel] = statements;
    expect(cancel?.text).toContain('effective_at_ms >');
    expect(cancel?.values[1]).toBeGreaterThanOrEqual(before);
    expect(createAuditLog).toHaveBeenCalledExactlyOnceWith(
      sql,
      expect.objectContaining({
        organizationId: 'org_1',
        actorId: 'admin_1',
        actorEmail: 'mia@example.test',
        action: 'policy.dsar_governance_loosening_cancelled',
      }),
    );
    expect(emitHintInTx).toHaveBeenCalledOnce();
  });

  it('finds nothing to cancel once the change took effect or another admin cancelled it', async () => {
    const { sql } = fakeSql(() => []);

    const refused = cancelPendingDsarPolicyChange(sql, ADMIN);

    await expect(refused).rejects.toBeInstanceOf(GovernanceTailError);
    await expect(refused).rejects.toMatchObject({
      code: 'NO_PENDING_CHANGE',
      status: 404,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });

  it('fails as a whole when the audit row cannot be written, so the cancel does not stand', async () => {
    const { sql, statements } = fakeSql((statement) =>
      isCancel(statement) ? [{ id: 'dsar_pending_1' }] : [],
    );
    createAuditLog.mockRejectedValue(new Error('audit chain unavailable'));

    await expect(cancelPendingDsarPolicyChange(sql, ADMIN)).rejects.toThrow(
      'audit chain unavailable',
    );
    expect(statements.filter(isCancel)).toEqual([
      expect.objectContaining({ inTransaction: true }),
    ]);
  });
});

describe('getDsarPolicyForUi — who proposed a staged weakening', () => {
  const STAGED = {
    id: 'dsar_pending_1',
    pendingConfig: {
      coolingOffHours: 1,
      requireDualApproval: false,
      dailyLimitPerAdmin: 5,
    },
    effectiveAt: Date.now() + 60 * 60 * 1000,
    proposedBy: 'user_ada',
    proposedByEmail: 'ada@example.test',
    proposedAt: Date.now() - 1000,
  };

  function staged(proposer: { name: string | null }[]) {
    return fakeSql((statement) => {
      if (statement.text.includes('effective_at_ms <=')) return [];
      if (statement.text.includes('FROM app.dsar_policy_pending_changes')) {
        return [STAGED];
      }
      return statement.text.includes('FROM "user"') ? proposer : [];
    });
  }

  it('names the proposer by their display name, beside the id and email', async () => {
    const { sql } = staged([{ name: 'Ada Lovelace' }]);

    const { pending } = await getDsarPolicyForUi(sql, {
      organizationId: 'org_1',
      role: 'admin',
    });

    expect(pending).toMatchObject({
      proposedBy: 'user_ada',
      proposedByEmail: 'ada@example.test',
      proposedByName: 'Ada Lovelace',
    });
  });

  it.each([[[]], [[{ name: null }]], [[{ name: '  ' }]]])(
    'leaves the name out when the account is gone or has none (%j)',
    async (proposer) => {
      const { sql } = staged(proposer);

      const { pending } = await getDsarPolicyForUi(sql, {
        organizationId: 'org_1',
        role: 'admin',
      });

      expect(pending).not.toHaveProperty('proposedByName');
      expect(pending?.proposedByEmail).toBe('ada@example.test');
    },
  );
});

describe('detectRetentionShortening', () => {
  it('sees a shortening in every bounded category, agentRuns and notifications included', () => {
    for (const field of Object.values(RETENTION_POLICY_FIELD_BY_CATEGORY)) {
      const summary = detectRetentionShortening(
        { [field]: 30 },
        { [field]: 7 },
      );
      expect(summary, field).not.toBeNull();
      expect(summary).toContain('(30 → 7)');
    }
  });

  it('still counts the grace window and ignores a category the new config disabled', () => {
    expect(
      detectRetentionShortening(
        { deletionGraceDays: 14 },
        { deletionGraceDays: 2 },
      ),
    ).toBe('Reduced: deletion grace (14 → 2)');
    expect(
      detectRetentionShortening(
        { agentRunsRetentionDays: 30 },
        { agentRunsRetentionDays: 7, agentRunsEnabled: false },
      ),
    ).toBeNull();
    expect(
      detectRetentionShortening(
        { agentRunsRetentionDays: 7 },
        { agentRunsRetentionDays: 30 },
      ),
    ).toBeNull();
  });
});
