/**
 * Unit tests for the artifact-side internal queries.
 *
 * Currently covers `findArtifactByCreatedMessage`, which backs the
 * `artifact_create` same-message guard: when an assistant reply has
 * already produced an artifact, the second `artifact_create` call gets a
 * soft `already_created_in_message` conflict instead of spawning a
 * duplicate project. Empty-string `createdByMessageId` must short-circuit
 * to null so multi-step / sub-agent edge cases don't cross-match every
 * empty-string row in the thread.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalQuery: (config: Record<string, unknown>) => config,
  };
});

import { findArtifactByCreatedMessage } from './internal_queries';

interface FakeArtifactRow {
  _id: string;
  organizationId: string;
  threadId: string;
  createdByMessageId?: string;
}

interface QueryHandler<TArgs, TReturn> {
  handler: (ctx: unknown, args: TArgs) => Promise<TReturn> | TReturn;
}

function createMockCtx(rows: FakeArtifactRow[]) {
  function makeBuilder() {
    const eqs: Record<string, unknown> = {};
    const matches = (): FakeArtifactRow[] =>
      rows.filter((r) => {
        if (
          eqs.organizationId !== undefined &&
          r.organizationId !== eqs.organizationId
        ) {
          return false;
        }
        if (eqs.threadId !== undefined && r.threadId !== eqs.threadId) {
          return false;
        }
        if (
          eqs.createdByMessageId !== undefined &&
          r.createdByMessageId !== eqs.createdByMessageId
        ) {
          return false;
        }
        return true;
      });
    const builder: Record<string, unknown> = {};
    builder.withIndex = vi.fn((_name: string, cb: (q: unknown) => unknown) => {
      const q = {
        eq: (field: string, value: unknown) => {
          eqs[field] = value;
          return q;
        },
      };
      cb(q);
      return builder;
    });
    builder.first = vi.fn(async () => {
      const list = matches();
      return list.length > 0 ? list[0] : null;
    });
    return builder;
  }
  return {
    ctx: { db: { query: vi.fn(() => makeBuilder()) } },
  };
}

type Args = {
  organizationId: string;
  threadId: string;
  createdByMessageId: string;
};

const find = findArtifactByCreatedMessage as unknown as QueryHandler<
  Args,
  FakeArtifactRow | null
>;

describe('findArtifactByCreatedMessage', () => {
  it('returns the existing artifact row when one matches the message id', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: 'msg_1',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    expect(result).not.toBeNull();
    expect(result?._id).toBe('art_1');
  });

  it('returns null when no artifact was created in this message', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: 'msg_OTHER',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    expect(result).toBeNull();
  });

  it('returns null without touching the db when createdByMessageId is empty', async () => {
    // Empty-string `createdByMessageId` is the multi-step / sub-agent
    // fallback — guarding against it prevents a stray empty-string row in
    // the thread from cross-matching every new tool call.
    const { ctx } = createMockCtx([
      {
        _id: 'art_1',
        organizationId: 'org_a',
        threadId: 'thr_a',
        createdByMessageId: '',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: '',
    });

    expect(result).toBeNull();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it('scopes the lookup to (organizationId, threadId, createdByMessageId)', async () => {
    const { ctx } = createMockCtx([
      {
        _id: 'art_other_org',
        organizationId: 'org_OTHER',
        threadId: 'thr_a',
        createdByMessageId: 'msg_1',
      },
      {
        _id: 'art_other_thread',
        organizationId: 'org_a',
        threadId: 'thr_OTHER',
        createdByMessageId: 'msg_1',
      },
    ]);

    const result = await find.handler(ctx, {
      organizationId: 'org_a',
      threadId: 'thr_a',
      createdByMessageId: 'msg_1',
    });

    // Both candidate rows live outside the current (org, thread) scope.
    expect(result).toBeNull();
  });
});
