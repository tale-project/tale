import { describe, expect, it } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';
import { taskAction } from './task_action';

// The workflow engine calls `taskAction.execute` directly, WITHOUT validating
// `parametersValidator` (see execute_action_node.ts), so a scheduled issue-desk
// reconcile whose `variables` never received an `owner`/`repo` value reaches
// `list_open_external` with them undefined. The guard must fail loudly with an
// actionable message — NOT degrade to an org-wide scan (which would close
// tasks in repos this desk was never configured to touch) and not surface the
// query's generic ArgumentValidationError.

type ExecParams = Parameters<typeof taskAction.execute>[1];

function stubCtx(): ActionCtx {
  // The guard throws before any ctx method runs; if it ever doesn't, these
  // throw to surface the leak instead of silently passing.
  const unexpected = () => {
    throw new Error('ctx method should not be reached when owner/repo missing');
  };
  return {
    runQuery: unexpected,
    runMutation: unexpected,
    runAction: unexpected,
  } as unknown as ActionCtx;
}

describe('taskAction list_open_external — missing repo config', () => {
  it('throws an actionable error when owner/repo are undefined', async () => {
    const params = {
      operation: 'list_open_external',
      externalSystem: 'github',
    } as unknown as ExecParams;

    await expect(
      taskAction.execute(stubCtx(), params, { organizationId: 'org_1' }),
    ).rejects.toThrow(/requires both `owner` and `repo`.*Triggers tab/s);
  });

  it('throws when owner is present but repo is missing', async () => {
    const params = {
      operation: 'list_open_external',
      externalSystem: 'github',
      owner: 'tale-project',
    } as unknown as ExecParams;

    await expect(
      taskAction.execute(stubCtx(), params, { organizationId: 'org_1' }),
    ).rejects.toThrow(/requires both `owner` and `repo`/);
  });

  it('throws when owner/repo are empty strings', async () => {
    const params = {
      operation: 'list_open_external',
      externalSystem: 'github',
      owner: '',
      repo: '',
    } as unknown as ExecParams;

    await expect(
      taskAction.execute(stubCtx(), params, { organizationId: 'org_1' }),
    ).rejects.toThrow(/requires both `owner` and `repo`/);
  });
});

describe('taskAction update_status — optional comment ride-along', () => {
  function recordingCtx() {
    const calls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
    const ctx = {
      runQuery: () => {
        throw new Error('unexpected runQuery');
      },
      runAction: () => {
        throw new Error('unexpected runAction');
      },
      runMutation: (ref: unknown, args: Record<string, unknown>) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
      },
    } as unknown as ActionCtx;
    return { ctx, calls };
  }

  it('posts the comment (as the workflow actor) before the status change', async () => {
    const { ctx, calls } = recordingCtx();
    const params = {
      operation: 'update_status',
      taskId: 'task_1',
      status: 'in_review',
      comment: '[automated] parked for a human',
    } as unknown as ExecParams;

    await taskAction.execute(ctx, params, { organizationId: 'org_1' });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.body).toBe('[automated] parked for a human');
    expect(calls[1]?.args.status).toBe('in_review');
  });

  it('skips the comment write when absent or blank', async () => {
    for (const comment of [undefined, '   ']) {
      const { ctx, calls } = recordingCtx();
      const params = {
        operation: 'update_status',
        taskId: 'task_1',
        status: 'todo',
        ...(comment !== undefined && { comment }),
      } as unknown as ExecParams;

      await taskAction.execute(ctx, params, { organizationId: 'org_1' });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.args.status).toBe('todo');
    }
  });
});

describe('taskAction list_comments — timeline feedback read', () => {
  // Fixture timeline (ascending): user asks → workflow posts figures with the
  // prepared anchor → user leaves two feedback comments → an agent replies.
  const timeline = [
    {
      messageId: 'm1',
      authorType: 'user',
      authorId: 'u1',
      body: 'is Q2 ready?',
      createdAt: 100,
    },
    {
      messageId: 'm2',
      authorType: 'agent',
      authorId: 'workflow',
      body: '[automated] [vat:prepared] figures…',
      createdAt: 200,
    },
    {
      messageId: 'm3',
      authorType: 'user',
      authorId: 'u1',
      body: 'box 302 looks wrong',
      createdAt: 300,
    },
    {
      messageId: 'm4',
      authorType: 'user',
      authorId: 'u2',
      body: 'DE invoices are reverse-charge',
      createdAt: 400,
    },
    {
      messageId: 'm5',
      authorType: 'agent',
      authorId: 'helper',
      body: 'looking into it',
      createdAt: 500,
    },
  ];

  function ctxListing(rows: unknown[]): ActionCtx {
    return {
      // Deliberately shuffled: the action must order by createdAt itself.
      runQuery: () => Promise.resolve(rows.toReversed()),
      runMutation: () => {
        throw new Error('unexpected runMutation');
      },
      runAction: () => {
        throw new Error('unexpected runAction');
      },
    } as unknown as ActionCtx;
  }

  function exec(params: Record<string, unknown>, rows: unknown[] = timeline) {
    return taskAction.execute(
      ctxListing(rows),
      {
        operation: 'list_comments',
        taskId: 'task_1',
        ...params,
      } as unknown as ExecParams,
      { organizationId: 'org_1' },
    ) as Promise<{ comments: Array<{ messageId: string }>; count: number }>;
  }

  it('returns the full timeline ascending when unfiltered', async () => {
    const result = await exec({});
    expect(result.count).toBe(5);
    expect(result.comments.map((c) => c.messageId)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
    ]);
  });

  it('filters to the requested author types', async () => {
    const result = await exec({ authorTypes: ['user'] });
    expect(result.comments.map((c) => c.messageId)).toEqual(['m1', 'm3', 'm4']);
    expect(result.count).toBe(3);
  });

  it('afterMarker keeps only comments strictly newer than the newest anchor', async () => {
    const result = await exec({ afterMarker: '[vat:prepared]' });
    expect(result.comments.map((c) => c.messageId)).toEqual(['m3', 'm4', 'm5']);
  });

  it('applies the watermark before the author filter (workflow anchor still consumes user comments)', async () => {
    const result = await exec({
      afterMarker: '[vat:prepared]',
      authorTypes: ['user'],
    });
    expect(result.comments.map((c) => c.messageId)).toEqual(['m3', 'm4']);
    expect(result.count).toBe(2);
  });

  it('afterMarker with no matching comment returns everything', async () => {
    const result = await exec({
      afterMarker: '[never-posted]',
      authorTypes: ['user'],
    });
    expect(result.comments.map((c) => c.messageId)).toEqual(['m1', 'm3', 'm4']);
  });

  it('an anchor as the newest comment yields an empty result', async () => {
    const anchored = [
      ...timeline,
      {
        messageId: 'm6',
        authorType: 'agent',
        authorId: 'workflow',
        body: '[automated] [vat:prepared] new figures',
        createdAt: 600,
      },
    ];
    const result = await exec(
      { afterMarker: '[vat:prepared]', authorTypes: ['user'] },
      anchored,
    );
    expect(result.comments).toEqual([]);
    expect(result.count).toBe(0);
  });

  it('limit keeps the most recent N, still ascending; non-positive is ignored', async () => {
    const limited = await exec({ authorTypes: ['user'], limit: 2 });
    expect(limited.comments.map((c) => c.messageId)).toEqual(['m3', 'm4']);
    const zero = await exec({ authorTypes: ['user'], limit: 0 });
    expect(zero.count).toBe(3);
  });

  it('an empty timeline yields count 0', async () => {
    const result = await exec({ afterMarker: '[vat:prepared]' }, []);
    expect(result.comments).toEqual([]);
    expect(result.count).toBe(0);
  });
});

describe('taskAction comment — bodyI18n snapshot', () => {
  function recordingCtx() {
    const calls: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
    const ctx = {
      runQuery: () => {
        throw new Error('unexpected runQuery');
      },
      runAction: () => {
        throw new Error('unexpected runAction');
      },
      runMutation: (ref: unknown, args: Record<string, unknown>) => {
        calls.push({ ref, args });
        return Promise.resolve({ messageId: 'm1', threadId: 't1' });
      },
    } as unknown as ActionCtx;
    return { ctx, calls };
  }

  it('stores en as body and passes bodyByLocale through', async () => {
    const { ctx, calls } = recordingCtx();
    const bodyI18n = {
      en: '[automated] prepared',
      de: '[automated] vorbereitet',
      fr: '[automated] préparé',
    };
    await taskAction.execute(
      ctx,
      {
        operation: 'comment',
        taskId: 'task_1',
        bodyI18n,
      } as unknown as ExecParams,
      { organizationId: 'org_1' },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.body).toBe('[automated] prepared');
    expect(calls[0]?.args.bodyByLocale).toEqual(bodyI18n);
  });

  it('still accepts a legacy single body', async () => {
    const { ctx, calls } = recordingCtx();
    await taskAction.execute(
      ctx,
      {
        operation: 'comment',
        taskId: 'task_1',
        body: '[automated] hello',
      } as unknown as ExecParams,
      { organizationId: 'org_1' },
    );

    expect(calls[0]?.args.body).toBe('[automated] hello');
    expect(calls[0]?.args.bodyByLocale).toBeUndefined();
  });

  it('rejects bodyI18n missing a locale', async () => {
    const { ctx } = recordingCtx();
    await expect(
      taskAction.execute(
        ctx,
        {
          operation: 'comment',
          taskId: 'task_1',
          bodyI18n: {
            en: '[automated] en',
            de: '',
            fr: '[automated] fr',
          },
        } as unknown as ExecParams,
        { organizationId: 'org_1' },
      ),
    ).rejects.toThrow(/bodyI18n/);
  });
});
