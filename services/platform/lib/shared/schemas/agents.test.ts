import { describe, expect, it } from 'vitest';

import {
  agentJsonSchema,
  agentRoutingSchema,
  responseTuningSchema,
} from './agents';

const baseAgent = {
  displayName: 'Test',
  systemInstructions: 'You are a test agent.',
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
};

describe('responseTuningSchema', () => {
  it('accepts a full valid config', () => {
    const r = responseTuningSchema.safeParse({
      effort: 'high',
      creativity: 'precise',
      style: 'concise',
      verbosity: 'terse',
      effortFloor: 'low',
      effortCeiling: 'high',
      budgetCaps: { easy: 1024, medium: 4096, hard: 16384 },
      temperatureRange: { min: 0.2, max: 0.8 },
      qualityProfile: 'strict',
    });
    expect(r.success).toBe(true);
  });

  it('rejects temperatureRange with min > max', () => {
    const r = responseTuningSchema.safeParse({
      temperatureRange: { min: 0.9, max: 0.2 },
    });
    expect(r.success).toBe(false);
  });

  it('rejects effortFloor > effortCeiling', () => {
    const r = responseTuningSchema.safeParse({
      effortFloor: 'high',
      effortCeiling: 'low',
    });
    expect(r.success).toBe(false);
  });

  it('rejects out-of-range budget caps', () => {
    expect(
      responseTuningSchema.safeParse({ budgetCaps: { easy: 1 } }).success,
    ).toBe(false);
    expect(
      responseTuningSchema.safeParse({ budgetCaps: { hard: 999999 } }).success,
    ).toBe(false);
  });

  it('rejects unknown enum values', () => {
    expect(responseTuningSchema.safeParse({ effort: 'turbo' }).success).toBe(
      false,
    );
  });
});

describe('agentRoutingSchema', () => {
  it('accepts auto selection + cascade with a draft model', () => {
    const r = agentRoutingSchema.safeParse({
      modelSelection: 'auto',
      cascade: true,
      cascadeDraftModel: 'openrouter:deepseek/deepseek-v4-flash',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid draft model ref', () => {
    const r = agentRoutingSchema.safeParse({ cascadeDraftModel: ':bad:' });
    expect(r.success).toBe(false);
  });
});

describe('agentJsonSchema carries the new optional blocks', () => {
  it('accepts an agent with responseTuning + routing', () => {
    const r = agentJsonSchema.safeParse({
      ...baseAgent,
      responseTuning: { effort: 'medium', qualityProfile: 'balanced' },
      routing: { modelSelection: 'auto' },
    });
    expect(r.success).toBe(true);
  });

  it('still accepts an agent without them (back-compat)', () => {
    expect(agentJsonSchema.safeParse(baseAgent).success).toBe(true);
  });
});

describe('agentJsonSchema — preferDurableStepForTasks', () => {
  it('accepts the flag on its own', () => {
    expect(
      agentJsonSchema.safeParse({
        ...baseAgent,
        preferDurableStepForTasks: true,
      }).success,
    ).toBe(true);
  });

  it('rejects the flag combined with runtime (mutually exclusive)', () => {
    const r = agentJsonSchema.safeParse({
      ...baseAgent,
      preferDurableStepForTasks: true,
      runtime: { adapterType: 'tale_daemon' },
    });
    expect(r.success).toBe(false);
  });

  it('allows runtime alone (flag absent/false)', () => {
    expect(
      agentJsonSchema.safeParse({
        ...baseAgent,
        runtime: { adapterType: 'tale_daemon' },
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...baseAgent,
        preferDurableStepForTasks: false,
        runtime: { adapterType: 'tale_daemon' },
      }).success,
    ).toBe(true);
  });
});

describe('agentJsonSchema — external-agent primaryBehavior', () => {
  const externalBase = {
    displayName: 'Coding Agent',
    supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    primaryBehavior: 'external-agent' as const,
  };

  it('accepts external-agent with agentKind (no systemInstructions required)', () => {
    expect(
      agentJsonSchema.safeParse({ ...externalBase, agentKind: 'claude-code' })
        .success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({ ...externalBase, agentKind: 'opencode' })
        .success,
    ).toBe(true);
  });

  it('accepts external-agent without agentKind (runtime defaults claude-code)', () => {
    expect(agentJsonSchema.safeParse(externalBase).success).toBe(true);
  });

  it('accepts authMode managed/byo on an external-agent', () => {
    expect(
      agentJsonSchema.safeParse({ ...externalBase, authMode: 'managed' })
        .success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({ ...externalBase, authMode: 'byo' }).success,
    ).toBe(true);
  });

  it('rejects authMode on a non-external-agent (chat)', () => {
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Chat Agent',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        systemInstructions: 'hi',
        authMode: 'byo',
      }).success,
    ).toBe(false);
  });

  it('rejects loop-only fields (toolNames/workflows) on an external-agent', () => {
    expect(
      agentJsonSchema.safeParse({ ...externalBase, toolNames: ['run_code'] })
        .success,
    ).toBe(false);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        workflows: ['some-workflow'],
      }).success,
    ).toBe(false);
  });

  it('accepts integrationBindings on an external-agent (sandbox dispatch grant set)', () => {
    // Unlike toolNames/workflows, integrationBindings is the grant set for the
    // in-container MCP integration bridge, so it is meaningful for external
    // agents even though they bypass the platform tool loop.
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'claude-code',
        integrationBindings: ['tavily', 'github'],
      }).success,
    ).toBe(true);
  });

  it('still rejects integrationBindings on an image-generation agent', () => {
    // The exception is scoped to external-agent only; image-generation has no
    // integration bridge, so integrationBindings stays disallowed there.
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Image Agent',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        primaryBehavior: 'image-generation' as const,
        integrationBindings: ['tavily'],
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid agentKind', () => {
    expect(
      agentJsonSchema.safeParse({ ...externalBase, agentKind: 'codex' })
        .success,
    ).toBe(false);
  });

  it('rejects agentKind on a non-external-agent', () => {
    expect(
      agentJsonSchema.safeParse({ ...baseAgent, agentKind: 'claude-code' })
        .success,
    ).toBe(false);
  });
});
