import { describe, it, expect } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

import { findRelatedAutomations } from '../find_related_automations';

type StepDoc = {
  _id: string;
  organizationId: string;
  wfDefinitionId: string;
  stepType: string;
  config: Record<string, unknown>;
  order: number;
};

type WfDefDoc = {
  _id: string;
  name: string;
  status: string;
  versionNumber: number;
  rootVersionId?: string;
};

function createMockCtx(steps: StepDoc[], definitions: WfDefDoc[]): QueryCtx {
  const defMap = new Map(definitions.map((d) => [d._id, d]));

  function makeAsyncIterable<T>(items: T[]) {
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i < items.length) {
              return { value: items[i++], done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  return {
    db: {
      get: ((id: string) => Promise.resolve(defMap.get(id) ?? null)) as never,
      query: (table: string) => {
        if (table === 'wfStepDefs') {
          return {
            withIndex: (
              _indexName: string,
              indexFn: (q: Record<string, unknown>) => void,
            ) => {
              // Capture the index filter params
              let orgId: string | undefined;
              let stepType: string | undefined;
              const q = {
                eq: (field: string, value: string) => {
                  if (field === 'organizationId') orgId = value;
                  if (field === 'stepType') stepType = value;
                  return q;
                },
              };
              indexFn(q);

              const filtered = steps.filter(
                (s) => s.organizationId === orgId && s.stepType === stepType,
              );
              return makeAsyncIterable(filtered);
            },
          };
        }
        if (table === 'wfDefinitions') {
          return {
            withIndex: (
              indexName: string,
              indexFn: (q: Record<string, unknown>) => void,
            ) => {
              let rootId: string | undefined;
              let status: string | undefined;
              const q = {
                eq: (field: string, value: string) => {
                  if (field === 'rootVersionId') rootId = value;
                  if (field === 'status') status = value;
                  return q;
                },
              };
              indexFn(q);

              const filtered = definitions.filter((d) => {
                if (indexName === 'by_root_status') {
                  return d.rootVersionId === rootId && d.status === status;
                }
                return false;
              });
              return makeAsyncIterable(filtered);
            },
          };
        }
        return { withIndex: () => makeAsyncIterable([]) };
      },
    },
  } as unknown as QueryCtx;
}

describe('findRelatedAutomations', () => {
  it('returns automations that reference the integration by name', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toEqual([
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        activeVersionId: null,
      },
    ]);
  });

  it('returns automations that reference via conversation action type', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'conversation',
          parameters: {
            operation: 'create_from_email',
            integrationName: 'gmail',
          },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'gmail-sync',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'gmail',
    });

    expect(result).toEqual([
      {
        _id: 'wfDef_1',
        name: 'gmail-sync',
        status: 'draft',
        activeVersionId: null,
      },
    ]);
  });

  it('deduplicates when multiple steps in same workflow reference the integration', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
      {
        _id: 'step_2',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_customers' },
        },
        order: 2,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('shopify-sync');
  });

  it('deduplicates across versions of the same workflow', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
      {
        _id: 'step_2',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_2',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
      {
        _id: 'wfDef_2',
        name: 'shopify-sync',
        status: 'active',
        versionNumber: 2,
        rootVersionId: 'wfDef_1',
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('shopify-sync');
  });

  it('returns empty array when no automations reference the integration', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'github', operation: 'list_repos' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'github-sync',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toEqual([]);
  });

  it('excludes automations from other organizations', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_2',
        stepType: 'action',
        wfDefinitionId: 'wfDef_1',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toEqual([]);
  });

  it('resolves effective status to active when active version also references integration', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
      {
        _id: 'step_2',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_2',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
      {
        _id: 'wfDef_2',
        name: 'shopify-sync',
        status: 'active',
        versionNumber: 2,
        rootVersionId: 'wfDef_1',
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('active');
    expect(result[0]?.activeVersionId).toBe('wfDef_2');
  });

  it('does not promote to active when active version removed the integration', async () => {
    // Only the draft (v1) references shopify; the active version (v2) does not
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'shopify-sync',
        status: 'draft',
        versionNumber: 1,
      },
      {
        _id: 'wfDef_2',
        name: 'shopify-sync',
        status: 'active',
        versionNumber: 2,
        rootVersionId: 'wfDef_1',
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('draft');
    expect(result[0]?.activeVersionId).toBeNull();
  });

  it('returns results sorted by name', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_products' },
        },
        order: 1,
      },
      {
        _id: 'step_2',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_2',
        stepType: 'action',
        config: {
          type: 'integration',
          parameters: { name: 'shopify', operation: 'list_orders' },
        },
        order: 1,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'z-workflow',
        status: 'draft',
        versionNumber: 1,
      },
      {
        _id: 'wfDef_2',
        name: 'a-workflow',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('a-workflow');
    expect(result[1]?.name).toBe('z-workflow');
  });

  it('skips steps without config or parameters', async () => {
    const steps: StepDoc[] = [
      {
        _id: 'step_1',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: {},
        order: 1,
      },
      {
        _id: 'step_2',
        organizationId: 'org_1',
        wfDefinitionId: 'wfDef_1',
        stepType: 'action',
        config: { type: 'integration' },
        order: 2,
      },
    ];

    const definitions: WfDefDoc[] = [
      {
        _id: 'wfDef_1',
        name: 'test-workflow',
        status: 'draft',
        versionNumber: 1,
      },
    ];

    const ctx = createMockCtx(steps, definitions);
    const result = await findRelatedAutomations(ctx, {
      organizationId: 'org_1',
      integrationName: 'shopify',
    });

    expect(result).toEqual([]);
  });
});
