import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// Mock the legal_hold module so we can drive `loadActiveHolds` per-test
// without booting Convex. The module imports auth and other Convex glue
// we don't want in the unit-test path.
const mockLoadActiveHolds = vi.fn();
vi.mock('../legal_hold', () => ({
  loadActiveHolds: (...args: unknown[]) => mockLoadActiveHolds(...args),
}));

// Stubs so the module under test can import without a real Convex env.
vi.mock('convex/values', () => {
  const stub = () => 'validator';
  return {
    v: {
      string: stub,
      number: stub,
      boolean: stub,
      optional: stub,
      union: stub,
      object: stub,
      literal: stub,
      array: stub,
      null: stub,
      id: stub,
      any: stub,
      bigint: stub,
      bytes: stub,
      float64: stub,
      int64: stub,
      record: stub,
    },
  };
});

vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalMutation: (config: Record<string, unknown>) => config,
  };
});

vi.mock('../../audit_logs/helpers', () => ({
  createAuditLog: vi.fn(),
}));

vi.mock('../../file_metadata/helpers', () => ({
  deleteStorageWithMetadata: vi.fn(),
}));

vi.mock('../../threads/cascade_helpers', () => ({
  cascadeDeleteThreadChildren: vi.fn(),
}));

import { assertSafeRetentionDelete } from '../internal_mutations_retention';

const ORG = 'org_main';
const NOW = 1_700_000_000_000;

function emptyHolds() {
  return {
    orgHeld: false,
    userMembershipIds: new Set<string>(),
  };
}

describe('assertSafeRetentionDelete — org + custodian-cascade gates', () => {
  // After the legal-hold simplification (commit 2 of the data-protection
  // bundle), `HOLD_TARGET_TYPES` was narrowed to `org` + `userMembership`
  // and `assertSafeRetentionDelete` accepts `authorUserId` instead of
  // `targetType+targetId`. Per-row thread/document/execution holds are
  // gone; cascade flows entirely through the row's author user id.

  it('blocks delete when authorUserId is on a userMembership hold', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      userMembershipIds: new Set(['user_held']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      authorUserId: 'user_held',
    });
    expect(result).toEqual({
      proceed: false,
      reason: 'user-custodian legal hold',
    });
  });

  it('permits delete when authorUserId is set but not on hold', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      userMembershipIds: new Set(['user_other']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      authorUserId: 'user_free',
    });
    expect(result).toEqual({ proceed: true });
  });

  it('permits delete when authorUserId is omitted and only org holds matter', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      userMembershipIds: new Set(['user_held']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
    });
    // CRM tables (customers, vendors, conversations) have no author
    // concept; with no `authorUserId` provided, only org-wide holds gate.
    expect(result).toEqual({ proceed: true });
  });

  it('blocks every category under an org-wide hold', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      orgHeld: true,
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      authorUserId: 'user_anything',
    });
    expect(result).toEqual({ proceed: false, reason: 'org legal hold' });
  });

  it('refuses cross-org row before consulting holds', async () => {
    mockLoadActiveHolds.mockClear();
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: 'org_other',
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      authorUserId: 'user_held',
    });
    expect(result).toEqual({ proceed: false, reason: 'cross-org mismatch' });
    expect(mockLoadActiveHolds).not.toHaveBeenCalled();
  });

  it('refuses TOCTOU-touched row before consulting holds', async () => {
    mockLoadActiveHolds.mockClear();
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW + 1000,
      cutoffMs: NOW,
      authorUserId: 'user_held',
    });
    expect(result).toEqual({
      proceed: false,
      reason: 'row no longer expired (TOCTOU)',
    });
    expect(mockLoadActiveHolds).not.toHaveBeenCalled();
  });
});

describe('retention mutations thread the right authorUserId (source-grep regression)', () => {
  // The bug being guarded: a retention mutation that doesn't pass
  // `authorUserId` to `assertSafeRetentionDelete` silently bypasses the
  // user-custodian cascade. Source-grep is the cheapest stable assertion
  // that the call site stays correct as new categories are added.
  const source = readFileSync(
    join(__dirname, '..', 'internal_mutations_retention.ts'),
    'utf-8',
  );

  function bodyOf(exportName: string): string {
    const start = source.indexOf(
      `export const ${exportName} = internalMutation(`,
    );
    if (start === -1) {
      throw new Error(`could not find export ${exportName}`);
    }
    // Bound the slice to the next top-level `export const` (or EOF) so
    // we don't catch the next handler's authorUserId.
    const next = source.indexOf('\nexport const ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it('deleteExpiredDocument cascades through doc.createdBy', () => {
    const body = bodyOf('deleteExpiredDocument');
    expect(body).toMatch(/authorUserId:\s*doc\.createdBy/);
  });

  it('markThreadExpired cascades through thread.userId', () => {
    const body = bodyOf('markThreadExpired');
    expect(body).toMatch(/authorUserId:\s*thread\.userId/);
  });

  it('deleteExpiredThread cascades through thread.userId', () => {
    const body = bodyOf('deleteExpiredThread');
    expect(body).toMatch(/authorUserId:\s*thread\.userId/);
  });

  it('deleteExpiredWorkflowExecution cascades through execution.userId', () => {
    const body = bodyOf('deleteExpiredWorkflowExecution');
    expect(body).toMatch(/authorUserId:\s*execution\.userId/);
  });

  it('deleteExpiredMessageFeedback cascades through row.userId', () => {
    const body = bodyOf('deleteExpiredMessageFeedback');
    expect(body).toMatch(/authorUserId:\s*row\.userId/);
  });

  it('deleteExpiredMemoryAuditRow cascades through subjectUserId', () => {
    const body = bodyOf('deleteExpiredMemoryAuditRow');
    expect(body).toMatch(/row\.subjectUserId/);
    expect(body).toMatch(/authorUserId/);
  });

  it('deleteExpiredChatFilterEvent cascades via parent thread userId', () => {
    const body = bodyOf('deleteExpiredChatFilterEvent');
    expect(body).toMatch(/authorUserId:\s*thread\?\.userId/);
  });

  it('deleteExpiredUsageLedgerRow cascades through row.userId', () => {
    const body = bodyOf('deleteExpiredUsageLedgerRow');
    expect(body).toMatch(/authorUserId:\s*row\.userId/);
  });

  it('deleteExpiredPromptTemplate cascades through row.createdBy', () => {
    const body = bodyOf('deleteExpiredPromptTemplate');
    expect(body).toMatch(/authorUserId:\s*row\.createdBy/);
  });
});

describe('retention_cleanup action-layer pre-filters via custodian cascade (source-grep regression)', () => {
  // First-line defence: the action drops held rows BEFORE calling the
  // mutation, so the mutation never wastes a write on a row that will
  // be refused. After the simplification the only surviving cascade is
  // user-membership; per-thread / per-document target types are gone.
  const cleanupSource = readFileSync(
    join(__dirname, '..', 'retention_cleanup.ts'),
    'utf-8',
  );

  function bodyOf(name: string): string {
    const start = cleanupSource.indexOf(`async function ${name}(`);
    if (start === -1) throw new Error(`could not find function ${name}`);
    const next = cleanupSource.indexOf('\nasync function ', start + 1);
    return cleanupSource.slice(start, next === -1 ? undefined : next);
  }

  it('cleanupDocuments pre-filters by holds.userMembershipIds via createdBy', () => {
    const body = bodyOf('cleanupDocuments');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(doc\.createdBy\)/);
  });

  it('cleanupChatHistory pre-filters via thread.userId', () => {
    const body = bodyOf('cleanupChatHistory');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(thread\.userId\)/);
  });

  it('cleanupMessageFeedback pre-filters via row.userId', () => {
    const body = bodyOf('cleanupMessageFeedback');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.userId\)/);
  });

  it('cleanupMemoryAudit pre-filters by subject/actor user holds', () => {
    const body = bodyOf('cleanupMemoryAudit');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.subjectUserId\)/);
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.actorUserId\)/);
  });

  it('cleanupWorkflowLogs pre-filters via execution.userId', () => {
    const body = bodyOf('cleanupWorkflowLogs');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(execution\.userId\)/);
  });

  it('cleanupPromptTemplates pre-filters by holds.userMembershipIds via createdBy', () => {
    const body = bodyOf('cleanupPromptTemplates');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.createdBy\)/);
  });
});

describe('hold simplification regression — per-row Sets are gone', () => {
  // The schema-level dead-code cleanup: ActiveHolds no longer carries
  // threadIds / documentIds / executionIds Sets, and no production
  // path consults them. Source-grep ensures the simplification stays in.
  const cleanupSource = readFileSync(
    join(__dirname, '..', 'retention_cleanup.ts'),
    'utf-8',
  );
  const erasureSource = readFileSync(
    join(__dirname, '..', 'erasure.ts'),
    'utf-8',
  );
  const guardSource = readFileSync(
    join(__dirname, '..', 'legal_hold_guard.ts'),
    'utf-8',
  );

  it('retention_cleanup.ts has no holds.threadIds / documentIds / executionIds checks', () => {
    expect(cleanupSource).not.toMatch(/holds\.threadIds\.has/);
    expect(cleanupSource).not.toMatch(/holds\.documentIds\.has/);
    expect(cleanupSource).not.toMatch(/holds\.executionIds\.has/);
  });

  it('erasure.ts has no holds.threadIds / documentIds checks', () => {
    expect(erasureSource).not.toMatch(/holds\.threadIds\.has/);
    expect(erasureSource).not.toMatch(/holds\.documentIds\.has/);
  });

  it('legal_hold_guard.ts checks org + userMembership only', () => {
    expect(guardSource).not.toMatch(/threadIds\.has/);
    expect(guardSource).not.toMatch(/documentIds\.has/);
    expect(guardSource).not.toMatch(/executionIds\.has/);
    expect(guardSource).toMatch(/userMembershipIds\.has/);
  });
});
