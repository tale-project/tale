/**
 * Config-variable exposure: workflow `config.variables` is namespaced under the
 * `config` key, so templates reference it as `{{config.backoffHours}}` (bare
 * `{{backoffHours}}` is rejected by validateVariableReferencesKnownSources).
 * Schedule/manual triggers carry no variables, so config.variables is the only
 * source for params like `backoffHours` used by workflow_processing_records.
 * Also covers rootWfDefinitionId injection (needed by processing-records steps).
 */

import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../_generated/server';
import { initializeExecutionVariables } from './initialize_execution_variables';
import type { ExecutionData, WorkflowConfig } from './types';

function makeCtx() {
  return {
    runMutation: vi.fn().mockResolvedValue(null),
    storage: { store: vi.fn() },
  } as unknown as ActionCtx;
}

const workflowConfig: WorkflowConfig = {
  name: 'Sync files from OneDrive',
  config: {
    variables: {
      organizationId: 'org_demo',
      backoffHours: 1,
      workflowId: 'onedrive_sync',
    },
  },
};

const baseArgs = {
  executionId: 'exec_1',
  organizationId: 'org_real',
};

describe('initializeExecutionVariables config variables', () => {
  it('namespaces config.variables under `config` on first init', async () => {
    const execution: ExecutionData = {
      _id: 'exec_1' as ExecutionData['_id'],
      wfDefinitionId: 'onedrive/sync-files-from-onedrive',
      workflowSlug: 'onedrive/sync-files-from-onedrive',
      variables: {},
    };

    const vars = await initializeExecutionVariables(
      makeCtx(),
      execution,
      baseArgs,
      workflowConfig,
    );

    expect((vars.config as Record<string, unknown>).backoffHours).toBe(1);
    // Bare top-level access is intentionally NOT provided (validator rejects it).
    expect(vars.backoffHours).toBeUndefined();
    // Real org id always wins over the placeholder in config.variables.
    expect(vars.organizationId).toBe('org_real');
  });

  it('keeps config.* available on later steps (non-empty vars)', async () => {
    const execution: ExecutionData = {
      _id: 'exec_1' as ExecutionData['_id'],
      wfDefinitionId: 'onedrive/sync-files-from-onedrive',
      workflowSlug: 'onedrive/sync-files-from-onedrive',
      variables: {
        steps: { start: { output: { type: 'start' } } },
        config: {
          organizationId: 'org_demo',
          backoffHours: 1,
          workflowId: 'onedrive_sync',
        },
      },
    };

    const vars = await initializeExecutionVariables(
      makeCtx(),
      execution,
      baseArgs,
      workflowConfig,
    );

    expect((vars.config as Record<string, unknown>).backoffHours).toBe(1);
    expect(vars.organizationId).toBe('org_real');
  });

  it('injects rootWfDefinitionId (falls back to slug for file workflows)', async () => {
    const execution: ExecutionData = {
      _id: 'exec_1' as ExecutionData['_id'],
      wfDefinitionId: 'onedrive/sync-files-from-onedrive',
      workflowSlug: 'onedrive/sync-files-from-onedrive',
      variables: {},
    };

    const vars = await initializeExecutionVariables(
      makeCtx(),
      execution,
      baseArgs,
      workflowConfig,
    );

    expect(vars.rootWfDefinitionId).toBe('onedrive/sync-files-from-onedrive');
  });
});
