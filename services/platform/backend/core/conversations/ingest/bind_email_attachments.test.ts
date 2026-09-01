// The pass that links a stored attachment to the mail it arrived on — and, now,
// starts its indexing. Two properties matter and neither is provable from the
// mutation alone: that one failure cannot stop the rest of a page of mail, and
// that the counts it reports are the counts a sync operator will read when
// attachments are silently not being bound.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/handler_names', () => ({
  internal: {
    file_metadata: {
      internal_mutations: { bindFileToConversation: 'bindFileToConversation' },
    },
  },
}));

const { bindEmailAttachments } = await import('./bind_email_attachments');

/** An ingested email carrying the given stored refs. */
function email(storageIds: Array<string | undefined>) {
  return {
    attachments: storageIds.map((storageId, index) => ({
      id: `att_${index}`,
      filename: 'cv.pdf',
      contentType: 'application/pdf',
      ...(storageId !== undefined ? { storageId } : {}),
    })),
  } as never;
}

function ctxReturning(outcomes: Record<string, string | Error>): {
  ctx: never;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  const ctx = {
    runMutation: vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      const outcome = outcomes[String(args.storageId)] ?? 'bound';
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
  return { ctx: ctx as never, calls };
}

describe('bindEmailAttachments', () => {
  it('counts what it bound and what it queued for indexing', async () => {
    const { ctx, calls } = ctxReturning({
      blob_a: 'bound_and_queued',
      blob_b: 'bound',
      blob_c: 'unchanged',
      // Already bound by an earlier poll, never indexed: work done, no new link.
      blob_d: 'queued',
    });

    const result = await bindEmailAttachments(ctx, {
      organizationId: 'org_1',
      bindings: [
        {
          email: email(['blob_a', 'blob_b']),
          conversationId: 'conv_1' as never,
        },
        {
          email: email(['blob_c', 'blob_d']),
          conversationId: 'conv_2' as never,
        },
      ],
    });

    expect(result).toEqual({ bound: 2, queued: 2, failed: 0 });
    // `unchanged` is a re-poll of already-indexed mail: visited, not counted.
    expect(calls).toHaveLength(4);
  });

  it('keeps going past a failure, and counts it', async () => {
    // The mail has already landed. Losing the rest of the page's links because
    // one row threw would leave those attachments unindexed until a poll that
    // happens to skip the same row.
    const { ctx, calls } = ctxReturning({
      blob_a: 'bound_and_queued',
      blob_boom: new Error('write conflict'),
      blob_c: 'bound_and_queued',
    });

    const result = await bindEmailAttachments(ctx, {
      organizationId: 'org_1',
      bindings: [
        {
          email: email(['blob_a', 'blob_boom', 'blob_c']),
          conversationId: 'conv_1' as never,
        },
      ],
    });

    expect(result).toEqual({ bound: 2, queued: 2, failed: 1 });
    expect(calls).toHaveLength(3);
  });

  it('skips a part that was never materialized', async () => {
    // A metadata-only chip has no stored bytes, so there is no row to bind.
    const { ctx, calls } = ctxReturning({});

    const result = await bindEmailAttachments(ctx, {
      organizationId: 'org_1',
      bindings: [
        {
          email: email([undefined, 'blob_real', undefined]),
          conversationId: 'conv_1' as never,
        },
      ],
    });

    expect(result).toEqual({ bound: 1, queued: 0, failed: 0 });
    expect(calls).toEqual([
      {
        organizationId: 'org_1',
        storageId: 'blob_real',
        conversationId: 'conv_1',
      },
    ]);
  });

  it('reports nothing for a page of mail with no attachments', async () => {
    const { ctx, calls } = ctxReturning({});
    const result = await bindEmailAttachments(ctx, {
      organizationId: 'org_1',
      bindings: [{ email: email([]), conversationId: 'conv_1' as never }],
    });
    expect(result).toEqual({ bound: 0, queued: 0, failed: 0 });
    expect(calls).toEqual([]);
  });
});
