import { describe, expect, it, vi } from 'vitest';

// Mock the loadConvexToolsAsObject dependency
vi.mock('../agent_tools/load_convex_tools_as_object', () => ({
  loadConvexToolsAsObject: () => ({}),
}));

import { createAgentConfig } from './create_agent_config';

function makeFakeModel() {
  return {
    specificationVersion: 'v3',
    modelId: 'test-model',
    provider: 'test-provider',
  } as never;
}

describe('createAgentConfig', () => {
  describe('callSettings.maxOutputTokens default', () => {
    it('defaults callSettings.maxOutputTokens to 8192 when maxTokens is not provided', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(8192);
    });

    it('uses caller-provided maxTokens when explicitly set', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        maxTokens: 4096,
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(4096);
    });

    it('respects maxTokens: 0 (uses 0 rather than the default)', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        maxTokens: 0,
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(0);
    });
  });

  describe('modelMaxOutputTokens precedence', () => {
    it('uses modelMaxOutputTokens when caller does not provide maxTokens', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        modelMaxOutputTokens: 4096,
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(4096);
    });

    it('caller maxTokens wins over modelMaxOutputTokens', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        maxTokens: 1024,
        modelMaxOutputTokens: 4096,
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(1024);
    });

    it('falls back to 8192 default when neither is provided', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
      });

      const callSettings = config.callSettings as
        | Record<string, number>
        | undefined;
      expect(callSettings?.maxOutputTokens).toBe(8192);
    });
  });

  describe('providerOptions is no longer agent-level', () => {
    it('config does not carry a providerOptions field', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
      });

      // providerOptions moved out of the Agent constructor and onto per-call
      // streamText/generateText/generateObject args. The createAgentConfig
      // shape should never produce it.
      expect(config).not.toHaveProperty('providerOptions');
    });
  });

  describe('maxSteps default', () => {
    it('defaults maxSteps to 40 when tools are provided but maxSteps is not', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        extraTools: { myTool: {} },
      });

      expect(config).toHaveProperty('maxSteps', 40);
    });

    it('does not set maxSteps when no tools are configured', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
      });

      expect(config).not.toHaveProperty('maxSteps');
    });
  });
});
