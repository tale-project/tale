import { describe, expect, it } from 'vitest';

import type { AgentJsonConfig } from '@/convex/agents/file_utils';
import { agentJsonSchema } from '@/lib/shared/schemas/agents';

import { nextConfigForBehavior } from './next-config-for-behavior';

// Mimic the editor's shallow-merge `updateConfig` so `undefined` keys in the
// patch actually clear the field (the real save path validates this merged
// object against `agentJsonSchema`).
function applyPatch(
  base: AgentJsonConfig,
  patch: Partial<AgentJsonConfig>,
): AgentJsonConfig {
  return { ...base, ...patch };
}

const chatWithLoopConfig: AgentJsonConfig = {
  displayName: 'Helper',
  systemInstructions: 'Assist the user.',
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
  toolNames: ['task_read'],
  workflows: ['some-workflow'],
  integrationBindings: ['github'],
};

const externalAgentConfig: AgentJsonConfig = {
  displayName: 'Software Developer',
  systemInstructions: 'Work the task.',
  primaryBehavior: 'external-agent',
  agentKind: 'claude-code',
  authMode: 'managed',
  nativeWebTools: true,
  integrationBindings: ['github'],
  supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
};

const byoExternalNoModelConfig: AgentJsonConfig = {
  displayName: 'BYO Coder',
  primaryBehavior: 'external-agent',
  agentKind: 'claude-code',
  authMode: 'byo',
  supportedModels: [],
};

describe('nextConfigForBehavior', () => {
  it('chat → external-agent clears loop-only tools/workflows and defaults the runtime, keeping integrations + models', () => {
    const patch = nextConfigForBehavior(chatWithLoopConfig, 'external-agent');
    const merged = applyPatch(chatWithLoopConfig, patch);

    expect(merged.toolNames).toBeUndefined();
    expect(merged.workflows).toBeUndefined();
    expect(merged.agentKind).toBe('claude-code');
    expect(merged.integrationBindings).toEqual(['github']);
    expect(agentJsonSchema.safeParse(merged).success).toBe(true);
  });

  it('keeps an existing agentKind when re-entering external-agent, pinning cursor to byo', () => {
    const cursor: AgentJsonConfig = {
      ...chatWithLoopConfig,
      agentKind: 'cursor',
    };
    const patch = nextConfigForBehavior(cursor, 'external-agent');
    const merged = applyPatch(cursor, patch);
    expect(merged.agentKind).toBe('cursor');
    // Cursor is BYO only — re-entering External must pin authMode so the config
    // passes the schema (which rejects cursor + managed/absent authMode).
    expect(merged.authMode).toBe('byo');
  });

  it('external-agent → chat clears agentKind/authMode/nativeWebTools and stays valid', () => {
    const patch = nextConfigForBehavior(externalAgentConfig, 'chat');
    const merged = applyPatch(externalAgentConfig, patch);

    expect(merged.primaryBehavior).toBe('chat');
    expect(merged.agentKind).toBeUndefined();
    expect(merged.authMode).toBeUndefined();
    // nativeWebTools is external-agent-only (superRefine); leaving it set would
    // fail validation on the now-chat agent.
    expect(merged.nativeWebTools).toBeUndefined();
    expect(agentJsonSchema.safeParse(merged).success).toBe(true);
  });

  it('chat → image-generation clears tools, workflows, integrations, agentKind, authMode', () => {
    const patch = nextConfigForBehavior(chatWithLoopConfig, 'image-generation');
    const merged = applyPatch(chatWithLoopConfig, patch);

    expect(merged.toolNames).toBeUndefined();
    expect(merged.workflows).toBeUndefined();
    expect(merged.integrationBindings).toBeUndefined();
    expect(merged.agentKind).toBeUndefined();
    expect(merged.authMode).toBeUndefined();
    expect(agentJsonSchema.safeParse(merged).success).toBe(true);
  });

  it('documents the byo-external(no model) → chat trap: the ≥1-model rule now bites', () => {
    const patch = nextConfigForBehavior(byoExternalNoModelConfig, 'chat');
    const merged = applyPatch(byoExternalNoModelConfig, patch);

    // The switch itself is clean (agentKind/authMode cleared); it's the
    // empty model list — legal only for byo-external — that fails. The UI warns
    // about this before switching and lets the honest save error surface.
    const result = agentJsonSchema.safeParse(merged);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.includes('supportedModels'),
        ),
      ).toBe(true);
    }
  });
});
