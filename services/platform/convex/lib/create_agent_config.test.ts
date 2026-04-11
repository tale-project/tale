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
  describe('providerOptions default maxOutputTokens', () => {
    it('sets providerOptions.openai.maxOutputTokens when maxTokens is not provided', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
      });

      expect(config).toHaveProperty('providerOptions');
      const providerOptions = config.providerOptions as Record<
        string,
        Record<string, unknown>
      >;
      expect(providerOptions).toHaveProperty('openai');
      expect(providerOptions.openai).toHaveProperty('maxOutputTokens', 8192);
    });

    it('does not set providerOptions when maxTokens is explicitly provided', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        maxTokens: 4096,
      });

      expect(config).not.toHaveProperty('providerOptions');
      expect(config).toHaveProperty('maxOutputTokens', 4096);
    });

    it('uses maxOutputTokens from maxTokens when maxTokens is 0', () => {
      const config = createAgentConfig({
        name: 'test-agent',
        languageModel: makeFakeModel(),
        instructions: 'You are a test assistant.',
        maxTokens: 0,
      });

      // maxTokens=0 is typeof number, so it should use maxOutputTokens: 0
      expect(config).toHaveProperty('maxOutputTokens', 0);
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
