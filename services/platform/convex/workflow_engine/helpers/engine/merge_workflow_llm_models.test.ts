import { describe, expect, it } from 'vitest';

import { mergeWorkflowLevelLLMModels } from './merge_workflow_llm_models';

describe('mergeWorkflowLevelLLMModels', () => {
  const wfModels = ['openrouter:a', 'openai:b'];

  it('returns config unchanged when workflow models is undefined', () => {
    const cfg = { name: 'step', systemPrompt: 'sys' };
    expect(mergeWorkflowLevelLLMModels(cfg, undefined)).toBe(cfg);
  });

  it('returns config unchanged when workflow models is empty', () => {
    const cfg = { name: 'step', systemPrompt: 'sys' };
    expect(mergeWorkflowLevelLLMModels(cfg, [])).toBe(cfg);
  });

  it('injects workflow models when step has neither `model` nor `models`', () => {
    const cfg = { name: 'step', systemPrompt: 'sys' };
    const merged = mergeWorkflowLevelLLMModels(cfg, wfModels);
    expect(merged).toEqual({ ...cfg, models: wfModels });
  });

  it('preserves step `model` and does not inject workflow models', () => {
    const cfg = { name: 'step', systemPrompt: 'sys', model: 'openrouter:foo' };
    expect(mergeWorkflowLevelLLMModels(cfg, wfModels)).toBe(cfg);
  });

  it('preserves step `models` and does not inject workflow models', () => {
    const cfg = {
      name: 'step',
      systemPrompt: 'sys',
      models: ['openrouter:x'],
    };
    expect(mergeWorkflowLevelLLMModels(cfg, wfModels)).toBe(cfg);
  });

  it('treats whitespace-only step `model` as absent (still inherits)', () => {
    const cfg = { name: 'step', systemPrompt: 'sys', model: '   ' };
    const merged = mergeWorkflowLevelLLMModels(cfg, wfModels);
    expect(merged).toEqual({ ...cfg, models: wfModels });
  });

  it('treats empty step `models` array as absent (still inherits)', () => {
    const cfg = { name: 'step', systemPrompt: 'sys', models: [] };
    const merged = mergeWorkflowLevelLLMModels(cfg, wfModels);
    expect(merged).toEqual({ ...cfg, models: wfModels });
  });

  it('handles the wrapped `{ llmNode }` form', () => {
    const cfg = { llmNode: { name: 'step', systemPrompt: 'sys' } };
    const merged = mergeWorkflowLevelLLMModels(cfg, wfModels);
    expect(merged).toEqual({
      llmNode: { name: 'step', systemPrompt: 'sys', models: wfModels },
    });
  });

  it('preserves wrapped form when inner has its own `model`', () => {
    const cfg = {
      llmNode: { name: 'step', systemPrompt: 'sys', model: 'openrouter:x' },
    };
    expect(mergeWorkflowLevelLLMModels(cfg, wfModels)).toBe(cfg);
  });

  it('returns non-object input unchanged', () => {
    expect(mergeWorkflowLevelLLMModels(null, wfModels)).toBeNull();
    expect(mergeWorkflowLevelLLMModels('str', wfModels)).toBe('str');
    expect(mergeWorkflowLevelLLMModels(42, wfModels)).toBe(42);
  });
});
