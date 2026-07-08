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
