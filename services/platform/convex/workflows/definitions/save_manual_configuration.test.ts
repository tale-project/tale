import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../../_generated/server';

import {
  saveManualConfiguration,
  type SaveManualConfigurationArgs,
} from './save_manual_configuration';

function createMockCtx() {
  const insertedDocs: Array<{ table: string; doc: Record<string, unknown> }> =
    [];
  const patchedDocs: Array<{
    id: string;
    patch: Record<string, unknown>;
  }> = [];
  let insertCounter = 0;

  const ctx = {
    db: {
      insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
        const id = `id_${insertCounter++}`;
        insertedDocs.push({ table, doc });
        return id;
      }),
      patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        patchedDocs.push({ id, patch });
      }),
    },
  };

  return { ctx, insertedDocs, patchedDocs };
}

const baseArgs: SaveManualConfigurationArgs = {
  organizationId: 'org_1',
  createdBy: 'user_123',
  workflowConfig: {
    name: 'Test Workflow',
    description: 'A test workflow',
  },
  stepsConfig: [
    {
      stepSlug: 'step-1',
      name: 'First Step',
      stepType: 'trigger',
      order: 0,
      config: {} as never,
      nextSteps: { default: 'step-2' },
    },
    {
      stepSlug: 'step-2',
      name: 'Second Step',
      stepType: 'action',
      order: 1,
      config: {} as never,
      nextSteps: {},
    },
  ],
};

describe('saveManualConfiguration', () => {
  it('creates a workflow with the provided createdBy', async () => {
    const { ctx, insertedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, baseArgs);

    const workflowDoc = insertedDocs.find((d) => d.table === 'wfDefinitions');
    expect(workflowDoc).toBeDefined();
    const metadata = workflowDoc?.doc.metadata as
      | Record<string, unknown>
      | undefined;
    expect(metadata?.createdBy).toBe('user_123');
  });

  it('does not hardcode createdBy', async () => {
    const { ctx, insertedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, {
      ...baseArgs,
      createdBy: 'admin_456',
    });

    const workflowDoc = insertedDocs.find((d) => d.table === 'wfDefinitions');
    const metadata = workflowDoc?.doc.metadata as
      | Record<string, unknown>
      | undefined;
    expect(metadata?.createdBy).toBe('admin_456');
  });

  it('creates all steps for the workflow', async () => {
    const { ctx, insertedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, baseArgs);

    const stepDocs = insertedDocs.filter((d) => d.table === 'wfStepDefs');
    expect(stepDocs).toHaveLength(2);
    expect(stepDocs[0].doc.stepSlug).toBe('step-1');
    expect(stepDocs[1].doc.stepSlug).toBe('step-2');
  });

  it('sets rootVersionId to the workflow itself', async () => {
    const { ctx, patchedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, baseArgs);

    expect(patchedDocs).toHaveLength(1);
    expect(patchedDocs[0].patch.rootVersionId).toBe(patchedDocs[0].id);
  });

  it('returns workflowId and stepIds', async () => {
    const { ctx } = createMockCtx();

    const result = await saveManualConfiguration(
      ctx as unknown as MutationCtx,
      baseArgs,
    );

    expect(result.workflowId).toBe('id_0');
    expect(result.stepIds).toHaveLength(2);
    expect(result.stepIds).toEqual(['id_1', 'id_2']);
  });

  it('uses default version v1 when not provided', async () => {
    const { ctx, insertedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, baseArgs);

    const workflowDoc = insertedDocs.find((d) => d.table === 'wfDefinitions');
    expect(workflowDoc?.doc.version).toBe('v1');
  });

  it('uses provided version when specified', async () => {
    const { ctx, insertedDocs } = createMockCtx();

    await saveManualConfiguration(ctx as unknown as MutationCtx, {
      ...baseArgs,
      workflowConfig: { ...baseArgs.workflowConfig, version: 'v2' },
    });

    const workflowDoc = insertedDocs.find((d) => d.table === 'wfDefinitions');
    expect(workflowDoc?.doc.version).toBe('v2');
  });
});
