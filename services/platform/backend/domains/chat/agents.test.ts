import { describe, expect, it } from 'vitest';

import { resolveDefaultChatAgent } from './agents';

const AGENTS = [{ id: 'oldest' }, { id: 'second' }, { id: 'newest' }];

describe('resolveDefaultChatAgent — who a project’s new chats start with [PROJ-R26]', () => {
  it('starts with the first agent created while the project names none', () => {
    expect(
      resolveDefaultChatAgent(
        { defaultChatAgentId: null, chatsStartWithAssistant: false },
        AGENTS,
      ),
    ).toBe('oldest');
    expect(resolveDefaultChatAgent({}, AGENTS)).toBe('oldest');
  });

  it('starts with the agent the project names', () => {
    expect(
      resolveDefaultChatAgent(
        { defaultChatAgentId: 'newest', chatsStartWithAssistant: false },
        AGENTS,
      ),
    ).toBe('newest');
  });

  it('falls back to the first agent created when the named one is gone [PROJ-R27]', () => {
    expect(
      resolveDefaultChatAgent(
        { defaultChatAgentId: 'deleted', chatsStartWithAssistant: false },
        AGENTS,
      ),
    ).toBe('oldest');
  });

  it('starts with the assistant when the project says so, or has no agent of its own', () => {
    expect(
      resolveDefaultChatAgent(
        { defaultChatAgentId: 'newest', chatsStartWithAssistant: true },
        AGENTS,
      ),
    ).toBeNull();
    expect(
      resolveDefaultChatAgent(
        { defaultChatAgentId: null, chatsStartWithAssistant: false },
        [],
      ),
    ).toBeNull();
  });
});
