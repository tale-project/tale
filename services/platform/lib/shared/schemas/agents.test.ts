import { describe, expect, it } from 'vitest';

import { agentJsonSchema, agentRoutingSchema } from './agents';

const baseAgent = {
  displayName: 'Test',
  systemInstructions: 'You are a test agent.',
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
};

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

describe('agentJsonSchema carries the optional routing block', () => {
  it('accepts an agent with routing', () => {
    const r = agentJsonSchema.safeParse({
      ...baseAgent,
      routing: { modelSelection: 'auto' },
    });
    expect(r.success).toBe(true);
  });

  it('still accepts an agent without it (back-compat)', () => {
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
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'cursor',
        authMode: 'byo',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'hermes',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'gemini',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'gemini',
        authMode: 'byo',
      }).success,
    ).toBe(true);
    // Codex supports both credential modes (managed gateway + BYO OpenAI).
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'codex',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'codex',
        authMode: 'byo',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'pi',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'pi',
        authMode: 'byo',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'openclaw',
      }).success,
    ).toBe(true);
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'openclaw',
        authMode: 'byo',
      }).success,
    ).toBe(true);
  });

  it('accepts external-agent with agentKind opencode (managed-only)', () => {
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'opencode',
        authMode: 'managed',
      }).success,
    ).toBe(true);
  });

  it('rejects opencode external-agent with byo authMode (OpenCode is managed-only)', () => {
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        agentKind: 'opencode',
        authMode: 'byo',
      }).success,
    ).toBe(false);
  });

  it('rejects cursor external-agent with managed authMode (Cursor is BYO only)', () => {
    const managed = agentJsonSchema.safeParse({
      ...externalBase,
      agentKind: 'cursor',
      authMode: 'managed',
    });
    expect(managed.success).toBe(false);
    // Absent authMode is also rejected — Cursor must be explicit byo.
    expect(
      agentJsonSchema.safeParse({ ...externalBase, agentKind: 'cursor' })
        .success,
    ).toBe(false);
  });

  it('accepts external-agent without agentKind (runtime defaults claude-code)', () => {
    expect(agentJsonSchema.safeParse(externalBase).success).toBe(true);
  });

  it('accepts cursor external-agent with no supportedModels (optional runtime hint)', () => {
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Cursor',
        primaryBehavior: 'external-agent',
        agentKind: 'cursor',
        authMode: 'byo',
        supportedModels: [],
      }).success,
    ).toBe(true);
  });

  it('accepts gateway-managed Claude Code with no supportedModels (dynamic defaults)', () => {
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Claude Code',
        primaryBehavior: 'external-agent',
        agentKind: 'claude-code',
        authMode: 'managed',
        supportedModels: [],
      }).success,
    ).toBe(true);
    // Omitted agentKind defaults to claude-code at runtime.
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Claude Code',
        primaryBehavior: 'external-agent',
        authMode: 'managed',
        supportedModels: [],
      }).success,
    ).toBe(true);
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

  it('accepts a valid visionModel ref on an external-agent', () => {
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        visionModel: 'openrouter:qwen/qwen3-vl-32b-instruct',
      }).success,
    ).toBe(true);
  });

  it('rejects an invalid visionModel ref', () => {
    expect(
      agentJsonSchema.safeParse({
        ...externalBase,
        visionModel: ':bad:',
      }).success,
    ).toBe(false);
  });

  it('rejects visionModel on a non-external-agent (chat)', () => {
    expect(
      agentJsonSchema.safeParse({
        displayName: 'Chat Agent',
        supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
        systemInstructions: 'hi',
        visionModel: 'openrouter:qwen/qwen3-vl-32b-instruct',
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
      agentJsonSchema.safeParse({ ...externalBase, agentKind: 'aider' })
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
