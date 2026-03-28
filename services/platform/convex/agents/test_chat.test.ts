import { describe, it, expect, beforeAll } from 'vitest';

import type { AgentJsonConfig } from './file_utils';

import { toSerializableConfig } from './config';

beforeAll(() => {
  process.env.OPENAI_MODEL = 'gpt-4o';
  process.env.OPENAI_FAST_MODEL = 'gpt-4o-mini';
  process.env.OPENAI_CODING_MODEL = 'o3';
});

function createMockConfig(
  overrides: Partial<AgentJsonConfig> = {},
): AgentJsonConfig {
  return {
    displayName: 'Test Agent',
    description: 'A test agent',
    systemInstructions: 'You are a helpful test agent.',
    toolNames: ['web', 'rag_search'],
    integrationBindings: ['integration_1'],
    modelPreset: 'standard',
    includeOrgKnowledge: true,
    maxSteps: 10,
    timeoutMs: 60000,
    outputReserve: 2048,
    ...overrides,
  };
}

describe('toSerializableConfig', () => {
  it('should map basic agent config fields', () => {
    const config = createMockConfig();
    const result = toSerializableConfig('test-agent', config);

    expect(result.name).toBe('test-agent');
    expect(result.instructions).toBe('You are a helpful test agent.');
    expect(result.convexToolNames).toEqual(['web', 'rag_search']);
    expect(result.integrationBindings).toEqual(['integration_1']);
    expect(result.model).toBe('gpt-4o');
    expect(result.maxSteps).toBe(10);
    expect(result.timeoutMs).toBe(60000);
    expect(result.outputReserve).toBe(2048);
  });

  it('should resolve model presets correctly', () => {
    expect(
      toSerializableConfig('a', createMockConfig({ modelPreset: 'fast' }))
        .model,
    ).toBe('gpt-4o-mini');

    expect(
      toSerializableConfig('a', createMockConfig({ modelPreset: 'advanced' }))
        .model,
    ).toBe('o3');

    expect(
      toSerializableConfig('a', createMockConfig({ modelPreset: 'standard' }))
        .model,
    ).toBe('gpt-4o');
  });

  it('should prefer modelId over modelPreset', () => {
    const config = createMockConfig({
      modelPreset: 'fast',
      modelId: 'custom-model',
    });
    const result = toSerializableConfig('a', config);
    expect(result.model).toBe('custom-model');
  });

  it('should merge knowledge files from binding', () => {
    const config = createMockConfig({ knowledgeMode: 'tool' });
    const result = toSerializableConfig('a', config, {
      knowledgeFiles: [
        {
          fileId: 'file_1' as never,
          fileName: 'doc.pdf',
          ragStatus: 'completed',
        },
        {
          fileId: 'file_2' as never,
          fileName: 'draft.pdf',
          ragStatus: 'running',
        },
      ],
    });

    expect(result.knowledgeFileIds).toEqual(['file_1']);
  });

  it('should pass team ID from binding', () => {
    const config = createMockConfig();
    const result = toSerializableConfig('a', config, { teamId: 'team_1' });
    expect(result.agentTeamId).toBe('team_1');
  });

  it('should handle delegates as string array', () => {
    const config = createMockConfig({
      delegates: ['web-assistant', 'file-assistant'],
    });
    const result = toSerializableConfig('a', config);
    expect(result.delegateAgentIds).toEqual([
      'web-assistant',
      'file-assistant',
    ]);
  });

  it('should default knowledgeMode to off', () => {
    const config = createMockConfig();
    const result = toSerializableConfig('a', config);
    expect(result.knowledgeMode).toBe('off');
  });

  it('should infer webSearchMode from toolNames', () => {
    const config = createMockConfig({ toolNames: ['web'] });
    const result = toSerializableConfig('a', config);
    expect(result.webSearchMode).toBe('tool');
  });
});
