import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../../../_generated/server';
import type { LLMNodeConfig } from '../../../../types';

vi.mock('../../../../../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));
vi.mock('../../../../../providers/resolve_model', () => ({
  resolveLanguageModelById: vi.fn(),
}));
vi.mock('../../../../../providers/circuit_breaker', () => ({
  recordFailure: vi.fn(),
}));
vi.mock('../execute_agent_with_tools', () => ({
  executeAgentWithTools: vi.fn(),
}));
vi.mock('../utils/process_prompts', () => ({
  processPrompts: vi.fn(() => ({ systemPrompt: 'sys', userPrompt: 'u' })),
}));
vi.mock('../utils/resolve_chat_model', () => ({
  resolveChatModel: vi.fn(),
  assertChatTag: vi.fn(),
}));
vi.mock('../utils/resolve_knowledge_file_ids', () => ({
  resolveKnowledgeFileIds: vi.fn(() => undefined),
}));
vi.mock('../utils/validate_and_normalize_config', () => ({
  validateAndNormalizeConfig: vi.fn((cfg: LLMNodeConfig) => cfg),
}));
vi.mock('../utils/create_llm_result', () => ({
  createLLMResult: vi.fn(
    (
      llmResult: { threadId: string; text?: string },
      _cfg: unknown,
      _meta: unknown,
    ) => ({
      output: llmResult.text ?? '',
      threadId: llmResult.threadId,
    }),
  ),
}));

import { recordFailure } from '../../../../../providers/circuit_breaker';
import { resolveLanguageModelById } from '../../../../../providers/resolve_model';
import { executeAgentWithTools } from '../execute_agent_with_tools';
import { executeLLMNode } from '../execute_llm_node';
import { resolveChatModel } from '../utils/resolve_chat_model';

const ctx = {} as ActionCtx;

const baseConfig: LLMNodeConfig = {
  name: 'step',
  systemPrompt: 'sys',
};

const stubResolved = (modelId: string, providerName = 'openrouter') => ({
  languageModel: { provider: 'mock' } as never,
  modelData: {
    providerName,
    modelId,
    baseUrl: 'http://example',
    apiKey: 'key',
    tags: ['chat'],
    supportsStructuredOutputs: false,
  },
});

const stubLLMResult = (text: string, threadId = 't1') => ({
  text,
  threadId,
  finishReason: 'stop',
  usage: {},
});

beforeEach(() => {
  vi.mocked(resolveLanguageModelById).mockReset();
  vi.mocked(executeAgentWithTools).mockReset();
  vi.mocked(resolveChatModel).mockReset();
  vi.mocked(recordFailure).mockReset();
});

describe('executeLLMNode chain mode', () => {
  it('returns the first chain entry when generation succeeds', async () => {
    vi.mocked(resolveLanguageModelById).mockResolvedValueOnce(
      stubResolved('a'),
    );
    vi.mocked(executeAgentWithTools).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      stubLLMResult('result-a') as never,
    );

    const result = await executeLLMNode(
      ctx,
      { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
      {},
      'exec1',
      'org1',
    );

    expect(result.output).toBe('result-a');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(1);
    expect(resolveLanguageModelById).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('falls over to the next model on a transient error and records circuit-breaker failure', async () => {
    vi.mocked(resolveLanguageModelById)
      .mockResolvedValueOnce(stubResolved('a'))
      .mockResolvedValueOnce(stubResolved('b', 'openai'));
    vi.mocked(executeAgentWithTools)
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limited'), { status: 429 }),
      )
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      .mockResolvedValueOnce(stubLLMResult('result-b') as never);

    const result = await executeLLMNode(
      ctx,
      { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
      {},
      'exec1',
      'org1',
    );

    expect(result.output).toBe('result-b');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(2);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith('openrouter', 'a');
  });

  it('falls over on non-transient failover-eligible errors (e.g. 401) without recording circuit breaker', async () => {
    vi.mocked(resolveLanguageModelById)
      .mockResolvedValueOnce(stubResolved('a'))
      .mockResolvedValueOnce(stubResolved('b', 'openai'));
    vi.mocked(executeAgentWithTools)
      .mockRejectedValueOnce(
        Object.assign(new Error('unauthorized'), { status: 401 }),
      )
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      .mockResolvedValueOnce(stubLLMResult('result-b') as never);

    const result = await executeLLMNode(
      ctx,
      { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
      {},
      'exec1',
      'org1',
    );

    expect(result.output).toBe('result-b');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(2);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('does not fall over on non-failover-eligible errors (e.g. content_policy)', async () => {
    vi.mocked(resolveLanguageModelById).mockResolvedValueOnce(
      stubResolved('a'),
    );
    vi.mocked(executeAgentWithTools).mockRejectedValueOnce(
      new Error('content_policy violation'),
    );

    await expect(
      executeLLMNode(
        ctx,
        { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
        {},
        'exec1',
        'org1',
      ),
    ).rejects.toThrow('content_policy violation');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('throws the last error when every chain entry fails', async () => {
    vi.mocked(resolveLanguageModelById)
      .mockResolvedValueOnce(stubResolved('a'))
      .mockResolvedValueOnce(stubResolved('b', 'openai'));
    vi.mocked(executeAgentWithTools)
      .mockRejectedValueOnce(
        Object.assign(new Error('first 503'), { status: 503 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('second 503'), { status: 503 }),
      );

    await expect(
      executeLLMNode(
        ctx,
        { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
        {},
        'exec1',
        'org1',
      ),
    ).rejects.toThrow('second 503');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(2);
  });

  it('falls over when resolution itself fails (e.g. provider not found)', async () => {
    vi.mocked(resolveLanguageModelById)
      .mockRejectedValueOnce(new Error('Provider "openrouter" not found'))
      .mockResolvedValueOnce(stubResolved('b', 'openai'));
    vi.mocked(executeAgentWithTools).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      stubLLMResult('result-b') as never,
    );

    const result = await executeLLMNode(
      ctx,
      { ...baseConfig, models: ['openrouter:a', 'openai:b'] },
      {},
      'exec1',
      'org1',
    );

    expect(result.output).toBe('result-b');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(1);
  });
});

describe('executeLLMNode mutual-exclusion', () => {
  it('throws INVALID_LLM_STEP_CONFIG when both `model` and `models` are set', async () => {
    let caught: unknown;
    try {
      await executeLLMNode(
        ctx,
        { ...baseConfig, model: 'openrouter:a', models: ['openai:b'] },
        {},
        'exec1',
        'org1',
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    const data = (caught as ConvexError<{ code: string; message: string }>)
      .data;
    expect(data.code).toBe('INVALID_LLM_STEP_CONFIG');
    expect(resolveLanguageModelById).not.toHaveBeenCalled();
    expect(resolveChatModel).not.toHaveBeenCalled();
  });
});

describe('executeLLMNode non-chain mode (backward compat)', () => {
  it('uses resolveChatModel and a single attempt when only `model` is set', async () => {
    vi.mocked(resolveChatModel).mockResolvedValueOnce(stubResolved('a'));
    vi.mocked(executeAgentWithTools).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      stubLLMResult('result-a') as never,
    );

    const result = await executeLLMNode(
      ctx,
      { ...baseConfig, model: 'openrouter:a' },
      {},
      'exec1',
      'org1',
    );

    expect(result.output).toBe('result-a');
    expect(resolveChatModel).toHaveBeenCalledTimes(1);
    expect(resolveLanguageModelById).not.toHaveBeenCalled();
    expect(executeAgentWithTools).toHaveBeenCalledTimes(1);
  });

  it('uses resolveChatModel (tag-based) when neither `model` nor `models` is set', async () => {
    vi.mocked(resolveChatModel).mockResolvedValueOnce(stubResolved('default'));
    vi.mocked(executeAgentWithTools).mockResolvedValueOnce(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test stub
      stubLLMResult('default-result') as never,
    );

    const result = await executeLLMNode(ctx, baseConfig, {}, 'exec1', 'org1');

    expect(result.output).toBe('default-result');
    expect(resolveChatModel).toHaveBeenCalledTimes(1);
  });

  it('does not retry when single `model` generation fails (no chain semantics)', async () => {
    vi.mocked(resolveChatModel).mockResolvedValueOnce(stubResolved('a'));
    vi.mocked(executeAgentWithTools).mockRejectedValueOnce(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );

    await expect(
      executeLLMNode(
        ctx,
        { ...baseConfig, model: 'openrouter:a' },
        {},
        'exec1',
        'org1',
      ),
    ).rejects.toThrow('rate limited');
    expect(executeAgentWithTools).toHaveBeenCalledTimes(1);
  });
});
