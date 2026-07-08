import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — this file wires an LLM call into a preview action; we test the
// WIRING (retry loop, validation gate, config assembly) with a mocked model,
// not semantic fidelity of any real generation.
// ---------------------------------------------------------------------------

vi.mock('../_generated/server', () => ({
  action: vi.fn((config) => config),
}));

const mockReadWorkflow = vi.fn();
const mockListIntegrations = vi.fn();
vi.mock('../_generated/api', () => ({
  components: { agent: {} },
  internal: {
    workflows: {
      file_actions: {
        readWorkflowForExecution: 'mock-readWorkflowForExecution',
      },
    },
    integrations: {
      file_actions: {
        listIntegrationsInternal: 'mock-listIntegrationsInternal',
      },
    },
  },
}));

vi.mock('../lib/auth/require_org_membership', () => ({
  requireOrgMembershipById: vi.fn().mockResolvedValue({
    orgSlug: 'default',
    userId: 'user-1',
    email: 'user@example.com',
  }),
}));

const mockModelData = {
  providerName: 'test-provider',
  baseUrl: 'https://example.test',
  apiKey: 'test-key',
  modelId: 'test-model',
  apiFormat: 'openai' as const,
  tags: ['chat'],
  supportsStructuredOutputs: true,
};

vi.mock('../providers/failover', () => ({
  resolveLanguageModelWithFallback: vi.fn().mockResolvedValue({
    languageModel: {},
    modelData: mockModelData,
  }),
}));

vi.mock('../lib/agent_response/reasoning/build_reasoning_options', () => ({
  reasoningProviderOptionsFor: vi.fn(() => undefined),
}));
vi.mock('../lib/provider_options', () => ({
  buildCallProviderOptions: vi.fn(() => undefined),
}));

const mockValidateWorkflowDefinition = vi.fn();
vi.mock(
  '../workflow_engine/helpers/validation/validate_workflow_definition',
  () => ({
    validateWorkflowDefinition: (...args: unknown[]) =>
      mockValidateWorkflowDefinition(...args),
  }),
);

const mockGenerateObject = vi.fn();
const mockGenerateText = vi.fn();
vi.mock('@convex-dev/agent', () => ({
  Agent: vi.fn().mockImplementation(function MockAgent() {
    return {
      generateObject: (...args: unknown[]) => mockGenerateObject(...args),
      generateText: (...args: unknown[]) => mockGenerateText(...args),
    };
  }),
}));

const { previewGraphFromSpecification, previewSpecificationFromGraph } =
  await import('./specification_actions');

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- action() mock returns the raw config object; we call its handler directly
const graphHandler = (
  previewGraphFromSpecification as unknown as {
    handler: (ctx: unknown, args: unknown) => unknown;
  }
).handler;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as above
const specHandler = (
  previewSpecificationFromGraph as unknown as {
    handler: (ctx: unknown, args: unknown) => unknown;
  }
).handler;

const baseWorkflowConfig = {
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start' as const,
      config: {},
      nextSteps: { success: 'finish' },
    },
    {
      stepSlug: 'finish',
      name: 'Finish',
      stepType: 'output' as const,
      config: {},
      nextSteps: {},
    },
  ],
};

function createCtx() {
  return {
    runAction: vi.fn((ref: string) => {
      if (ref === 'mock-readWorkflowForExecution') {
        return mockReadWorkflow();
      }
      if (ref === 'mock-listIntegrationsInternal') {
        return mockListIntegrations();
      }
      throw new Error(`unexpected runAction ref: ${ref}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadWorkflow.mockResolvedValue({ ok: true, config: baseWorkflowConfig });
  mockListIntegrations.mockResolvedValue([]);
});

describe('previewGraphFromSpecification', () => {
  it('rejects an empty specification without calling the model', async () => {
    const result = await graphHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
      specification: '   ',
    });
    expect(result).toMatchObject({ ok: false });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('reports the workflow as not found without calling the model', async () => {
    mockReadWorkflow.mockResolvedValue({ ok: false, message: 'nope' });
    const result = await graphHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
      specification: 'Do a thing.',
    });
    expect(result).toMatchObject({ ok: false });
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('builds a candidate config on a valid first attempt, preserving name/description', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        workflowConfig: { name: 'Test Workflow' },
        stepsConfig: [
          {
            stepSlug: 'start',
            name: 'Start',
            stepType: 'start',
            config: {},
            nextSteps: { success: 'finish' },
          },
          {
            stepSlug: 'finish',
            name: 'Finish',
            stepType: 'output',
            config: {},
            nextSteps: {},
          },
        ],
      },
    });
    mockValidateWorkflowDefinition.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });

    const result = await graphHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
      specification: 'Start, then finish.',
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the ok:true assertion above
    const ok = result as {
      ok: true;
      config: typeof baseWorkflowConfig & {
        specification: string;
        specificationMeta: { direction: string; sourceHash: string };
      };
    };
    expect(ok.config.name).toBe('Test Workflow');
    expect(ok.config.description).toBe('A test workflow');
    expect(ok.config.specification).toBe('Start, then finish.');
    expect(ok.config.specificationMeta.direction).toBe('spec_to_graph');
    expect(ok.config.specificationMeta.sourceHash).toBeTruthy();
  });

  it('retries on validation failure, then succeeds', async () => {
    mockGenerateObject
      .mockResolvedValueOnce({
        object: {
          workflowConfig: { name: 'Test Workflow' },
          stepsConfig: [
            {
              stepSlug: 'start',
              name: 'Start',
              stepType: 'start',
              config: {},
              nextSteps: { success: 'nowhere' },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          workflowConfig: { name: 'Test Workflow' },
          stepsConfig: [
            {
              stepSlug: 'start',
              name: 'Start',
              stepType: 'start',
              config: {},
              nextSteps: { success: 'finish' },
            },
            {
              stepSlug: 'finish',
              name: 'Finish',
              stepType: 'output',
              config: {},
              nextSteps: {},
            },
          ],
        },
      });
    mockValidateWorkflowDefinition
      .mockReturnValueOnce({
        valid: false,
        errors: ['nextSteps points at an unknown step'],
        warnings: [],
      })
      .mockReturnValueOnce({ valid: true, errors: [], warnings: [] });

    const result = await graphHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
      specification: 'Start, then finish.',
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true });
  });

  it('returns errors after exhausting retries', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        workflowConfig: { name: 'Test Workflow' },
        stepsConfig: [],
      },
    });
    mockValidateWorkflowDefinition.mockReturnValue({
      valid: false,
      errors: ['No start or trigger step found.'],
      warnings: [],
    });

    const result = await graphHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
      specification: 'Start, then finish.',
    });

    expect(mockGenerateObject).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      errors: ['No start or trigger step found.'],
    });
  });
});

describe('previewSpecificationFromGraph', () => {
  it('returns the polished text and the current graph fingerprint', async () => {
    mockGenerateText.mockResolvedValue({ text: 'A polished specification.' });

    const result = await specHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
    });

    expect(result).toMatchObject({
      specification: 'A polished specification.',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted above
    expect((result as { sourceHash: string }).sourceHash).toBeTruthy();
  });

  it('falls back to the raw outline if the model never returns text', async () => {
    mockGenerateText.mockResolvedValue({ text: '' });

    const result = await specHandler(createCtx(), {
      organizationId: 'org-1',
      workflowSlug: 'wf-1',
    });

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape asserted by the test's own expectations
    const { specification } = result as { specification: string };
    expect(specification).toContain('# Test Workflow');
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });

  it('throws when the workflow cannot be read', async () => {
    mockReadWorkflow.mockResolvedValue({ ok: false, message: 'nope' });
    await expect(
      specHandler(createCtx(), {
        organizationId: 'org-1',
        workflowSlug: 'wf-1',
      }),
    ).rejects.toThrow();
  });
});
