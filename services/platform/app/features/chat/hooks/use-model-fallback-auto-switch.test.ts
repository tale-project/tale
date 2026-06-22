// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatModelFallbackBody,
  SYSTEM_MSG_TAG,
} from '@/lib/shared/constants/system-message-tags';

import type { ChatMessage } from './use-message-processing';
import { useModelFallbackAutoSwitch } from './use-model-fallback-auto-switch';

function msg(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    key: overrides.id,
    content: '',
    role: 'user',
    timestamp: new Date(0),
    ...overrides,
  };
}

const fallback = (id: string, model: string): ChatMessage =>
  msg({
    id,
    role: 'system',
    systemMessageTag: SYSTEM_MSG_TAG.MODEL_FALLBACK,
    systemMessageBody: formatModelFallbackBody({
      from: 'gpt-5',
      to: model,
      reason: 'provider_unreachable',
    }),
  });

const assistant = (id: string): ChatMessage =>
  msg({ id, role: 'assistant', content: 'Here is the answer.' });

interface Props {
  messages: ChatMessage[];
  agentName: string | undefined;
  isLoading: boolean;
  selectedModelOverrides: Record<string, string>;
  setSelectedModelOverride: (agentName: string, modelId: string | null) => void;
}

function setup(props: Partial<Props> = {}) {
  const setSelectedModelOverride = props.setSelectedModelOverride ?? vi.fn();
  const initialProps: Props = {
    messages: [],
    agentName: 'agent-1',
    isLoading: false,
    selectedModelOverrides: {},
    setSelectedModelOverride,
    ...props,
  };
  const utils = renderHook((p: Props) => useModelFallbackAutoSwitch(p), {
    initialProps,
  });
  return { ...utils, setSelectedModelOverride };
}

describe('useModelFallbackAutoSwitch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('switches the selector to the fallback model once a response follows it', () => {
    const { setSelectedModelOverride } = setup({
      messages: [fallback('f1', 'anthropic/claude'), assistant('a1')],
    });
    expect(setSelectedModelOverride).toHaveBeenCalledWith(
      'agent-1',
      'anthropic/claude',
    );
  });

  it('does not switch while a response is still streaming (isLoading guard)', () => {
    const { setSelectedModelOverride } = setup({
      messages: [fallback('f1', 'anthropic/claude'), assistant('a1')],
      isLoading: true,
    });
    expect(setSelectedModelOverride).not.toHaveBeenCalled();
  });

  it('captures model names that contain dots (greedy up to the trailing period)', () => {
    const { setSelectedModelOverride } = setup({
      messages: [fallback('f1', 'moonshotai/kimi-k2.5'), assistant('a1')],
    });
    expect(setSelectedModelOverride).toHaveBeenCalledWith(
      'agent-1',
      'moonshotai/kimi-k2.5',
    );
  });

  it('does not switch when no assistant message follows the fallback', () => {
    const { setSelectedModelOverride } = setup({
      messages: [fallback('f1', 'anthropic/claude')],
    });
    expect(setSelectedModelOverride).not.toHaveBeenCalled();
  });

  it('does not switch when the fallback model already equals the selection', () => {
    const { setSelectedModelOverride } = setup({
      messages: [fallback('f1', 'anthropic/claude'), assistant('a1')],
      selectedModelOverrides: { 'agent-1': 'anthropic/claude' },
    });
    expect(setSelectedModelOverride).not.toHaveBeenCalled();
  });

  it('processes a given fallback message only once across re-renders', () => {
    const messages = [fallback('f1', 'anthropic/claude'), assistant('a1')];
    const { rerender, setSelectedModelOverride } = setup({ messages });
    // A fresh array identity (same content) must not re-trigger the switch.
    rerender({
      messages: [...messages],
      agentName: 'agent-1',
      isLoading: false,
      selectedModelOverrides: {},
      setSelectedModelOverride,
    });
    expect(setSelectedModelOverride).toHaveBeenCalledTimes(1);
  });
});
