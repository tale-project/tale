/**
 * Who answers in a chat that does not exist yet: the project's default
 * chat agent until the person picks — and a pick of the assistant is a
 * pick, which the first message creates the chat with.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ComposerModelOption } from '../types';
import { useChatWhoAnswers } from './use-chat-who-answers';

const AGENTS = [
  {
    id: 'agent-1',
    name: 'Copy reviewer',
    model: 'chat-model',
    modelProvider: null,
  },
  { id: 'agent-2', name: 'Coder', model: 'chat-model', modelProvider: null },
];

vi.mock('../data/chat-backend', () => ({
  useChatProjectAgents: (_org: string, projectId: string | undefined) =>
    projectId === undefined
      ? { status: 'loading' }
      : {
          status: 'ready',
          data: { agents: AGENTS, defaultAgentId: 'agent-1' },
        },
  useConversationAgent: () => ({ save: () => Promise.resolve(true) }),
}));

const MODELS: ComposerModelOption[] = [];

function renderDraft() {
  return renderHook(() =>
    useChatWhoAnswers({
      organizationId: 'org_1',
      threadId: undefined,
      draftProjectId: 'project-1',
      thread: undefined,
      models: MODELS,
      preferredPick: undefined,
      setSelection: () => undefined,
      onSaveFailed: () => undefined,
    }),
  );
}

describe('who answers in a new chat [CHAT-R42] [CHAT-R43]', () => {
  it('starts with the project’s default chat agent, picked by nobody yet', () => {
    const { result } = renderDraft();
    expect(result.current.agentId).toBe('agent-1');
    expect(result.current.newChatAgentId).toBeUndefined();
  });

  it('takes a pick of another agent, and of the assistant, for what it is', () => {
    const { result } = renderDraft();
    act(() => result.current.chooseAgent('agent-2'));
    expect(result.current.agentId).toBe('agent-2');
    expect(result.current.newChatAgentId).toBe('agent-2');
    act(() => result.current.chooseAgent(null));
    expect(result.current.agentId).toBeNull();
    expect(result.current.agent).toBeUndefined();
    expect(result.current.newChatAgentId).toBeNull();
  });
});
