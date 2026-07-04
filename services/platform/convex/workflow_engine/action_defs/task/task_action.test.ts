import { describe, expect, it } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';
import { taskAction } from './task_action';

// The workflow engine calls `taskAction.execute` directly, WITHOUT validating
// `parametersValidator` (see execute_action_node.ts), so a scheduled issue-desk
// reconcile whose `variables` never received the app's `repository` config
// reaches `list_open_external` with `owner`/`repo` undefined. The guard must
// fail loudly with an actionable message — NOT degrade to an org-wide scan
// (which would close tasks in repos this desk was never configured to touch)
// and not surface the query's generic ArgumentValidationError.

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
    ).rejects.toThrow(/requires both `owner` and `repo`.*repository config/s);
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
