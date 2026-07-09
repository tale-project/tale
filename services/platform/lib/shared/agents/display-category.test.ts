import { describe, expect, it } from 'vitest';

import {
  getAgentDisplayCategory,
  getTaskDispatchHintKey,
  looksLikeCodeTask,
} from './display-category';

describe('getAgentDisplayCategory', () => {
  it('classifies default chat agents as agent', () => {
    expect(getAgentDisplayCategory({})).toBe('agent');
    expect(getAgentDisplayCategory({ primaryBehavior: 'chat' })).toBe('agent');
  });

  it('classifies image-generation as image-agent', () => {
    expect(
      getAgentDisplayCategory({ primaryBehavior: 'image-generation' }),
    ).toBe('image-agent');
  });

  it('classifies external-agent as coding-agent', () => {
    expect(getAgentDisplayCategory({ primaryBehavior: 'external-agent' })).toBe(
      'coding-agent',
    );
  });

  it('classifies runtime-bound chat agents as coding-agent', () => {
    expect(
      getAgentDisplayCategory({
        primaryBehavior: 'chat',
        runtime: { adapterType: 'claude_code' },
      }),
    ).toBe('coding-agent');
  });

  it('classifies durable-task agents as coding-agent', () => {
    expect(
      getAgentDisplayCategory({
        primaryBehavior: 'chat',
        preferDurableStepForTasks: true,
      }),
    ).toBe('coding-agent');
  });

  it('classifies the hasRuntime UI wire shape as coding-agent', () => {
    // listAgents / FE adapters expose `hasRuntime`, never a raw `runtime`.
    expect(
      getAgentDisplayCategory({ primaryBehavior: 'chat', hasRuntime: true }),
    ).toBe('coding-agent');
  });
});

describe('getTaskDispatchHintKey', () => {
  it('returns agent-platform for internal agents', () => {
    expect(getTaskDispatchHintKey({})).toBe('agent-platform');
  });

  it('returns coding-daemon when runtime is set', () => {
    expect(
      getTaskDispatchHintKey({
        primaryBehavior: 'external-agent',
        runtime: { adapterType: 'claude_code' },
      }),
    ).toBe('coding-daemon');
  });

  it('returns coding-daemon for the hasRuntime UI wire shape', () => {
    expect(
      getTaskDispatchHintKey({ primaryBehavior: 'chat', hasRuntime: true }),
    ).toBe('coding-daemon');
  });

  it('returns coding-durable when preferDurableStepForTasks is set', () => {
    expect(
      getTaskDispatchHintKey({
        primaryBehavior: 'chat',
        preferDurableStepForTasks: true,
      }),
    ).toBe('coding-durable');
  });

  it('returns coding-sandbox-only for external-agent without runtime or durable', () => {
    expect(getTaskDispatchHintKey({ primaryBehavior: 'external-agent' })).toBe(
      'coding-sandbox-only',
    );
  });

  it('returns null for image agents', () => {
    expect(
      getTaskDispatchHintKey({ primaryBehavior: 'image-generation' }),
    ).toBeNull();
  });
});

describe('looksLikeCodeTask', () => {
  it('detects code-oriented labels', () => {
    expect(looksLikeCodeTask({ title: 'Weekly update', labels: ['bug'] })).toBe(
      true,
    );
  });

  it('detects code keywords in title', () => {
    expect(looksLikeCodeTask({ title: 'Fix login regression' })).toBe(true);
  });

  it('returns false for generic personal deliverables', () => {
    expect(
      looksLikeCodeTask({
        title: 'Prepare board deck',
        description: 'Slides for Thursday meeting',
      }),
    ).toBe(false);
  });
});
