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
    threadIds: new Set<string>(),
    documentIds: new Set<string>(),
    executionIds: new Set<string>(),
    userMembershipIds: new Set<string>(),
  };
}

describe('assertSafeRetentionDelete — thread / userMembership gates', () => {
  it('blocks delete when targetType=thread and the thread is held', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      threadIds: new Set(['thr_held']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      targetType: 'thread',
      targetId: 'thr_held',
    });
    expect(result).toEqual({ proceed: false, reason: 'thread legal hold' });
  });

  it('permits delete when targetType=thread but the thread is not held', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      threadIds: new Set(['thr_other']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      targetType: 'thread',
      targetId: 'thr_free',
    });
    expect(result).toEqual({ proceed: true });
  });

  it('blocks delete when targetType=userMembership and the subject user is held', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      userMembershipIds: new Set(['user_subject']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
      targetType: 'userMembership',
      targetId: 'user_subject',
    });
    expect(result).toEqual({
      proceed: false,
      reason: 'user-membership legal hold',
    });
  });

  it('regression: caller that omits targetType bypasses thread/user holds (the broken pattern)', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      threadIds: new Set(['thr_held']),
      userMembershipIds: new Set(['user_held']),
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
    });
    // Documents the *old* bug: with no targetType, only org-wide holds
    // gate the row. The fix in this PR is that the three retention
    // mutations (chatFilterEvent / messageFeedback / memoryAuditRow)
    // now thread targetType through — the source-grep tests below
    // lock that in.
    expect(result).toEqual({ proceed: true });
  });

  it('still blocks every category under an org-wide hold', async () => {
    mockLoadActiveHolds.mockResolvedValueOnce({
      ...emptyHolds(),
      orgHeld: true,
    });
    const result = await assertSafeRetentionDelete({} as never, {
      rowOrganizationId: ORG,
      expectedOrganizationId: ORG,
      rowEffectiveMs: NOW - 1000,
      cutoffMs: NOW,
    });
    expect(result).toEqual({ proceed: false, reason: 'org legal hold' });
  });
});

describe('retention mutations thread the right targetType (source-grep regression)', () => {
  // The bug was that the three mutations below didn't pass targetType /
  // targetId to assertSafeRetentionDelete, so thread / user holds were
  // bypassed. Behavioural mocking of internalMutation handlers is
  // heavyweight; a source-grep is the cheapest stable assertion that
  // the call site stays correct.
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
    // we don't catch the next handler's targetType.
    const next = source.indexOf('\nexport const ', start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  }

  it('deleteExpiredChatFilterEvent gates by thread hold', () => {
    const body = bodyOf('deleteExpiredChatFilterEvent');
    expect(body).toMatch(/targetType:\s*'thread'/);
    expect(body).toMatch(/targetId:\s*row\.threadId/);
  });

  it('deleteExpiredMessageFeedback gates by thread hold', () => {
    const body = bodyOf('deleteExpiredMessageFeedback');
    expect(body).toMatch(/targetType:\s*'thread'/);
    expect(body).toMatch(/targetId:\s*row\.threadId/);
  });

  it('deleteExpiredMemoryAuditRow gates by thread (when row has one) or subject user', () => {
    const body = bodyOf('deleteExpiredMemoryAuditRow');
    expect(body).toMatch(/row\.threadId/);
    expect(body).toMatch(/'userMembership'/);
    expect(body).toMatch(/row\.subjectUserId/);
  });
});

describe('retention_cleanup action-layer pre-filters by hold sets (source-grep regression)', () => {
  // First-line defence: the action drops held rows BEFORE calling the
  // mutation, so the mutation never wastes a write on a row that will
  // be refused. Mirror of the mutation regressions above.
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

  it('cleanupChatFilterEvents pre-filters by holds.threadIds', () => {
    expect(bodyOf('cleanupChatFilterEvents')).toMatch(
      /holds\.threadIds\.has\(row\.threadId\)/,
    );
  });

  it('cleanupMessageFeedback pre-filters by holds.threadIds (in addition to userMembership)', () => {
    const body = bodyOf('cleanupMessageFeedback');
    expect(body).toMatch(/holds\.threadIds\.has\(row\.threadId\)/);
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.userId\)/);
  });

  it('cleanupMemoryAudit pre-filters by subject/actor user holds and thread hold', () => {
    const body = bodyOf('cleanupMemoryAudit');
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.subjectUserId\)/);
    expect(body).toMatch(/holds\.userMembershipIds\.has\(row\.actorUserId\)/);
    expect(body).toMatch(/holds\.threadIds\.has\(row\.threadId\)/);
  });
});
