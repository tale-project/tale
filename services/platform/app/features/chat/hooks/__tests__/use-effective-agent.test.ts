// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SelectedAgent } from '../../context/chat-layout-context';

interface MockAgent {
  name: string;
  displayName: string;
  description: string;
  conversationStarters?: string[];
}

let mockSelectedAgent: SelectedAgent | null = null;
let mockAgents: MockAgent[] | undefined;

vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedAgent: mockSelectedAgent,
  }),
}));

vi.mock('../queries', () => ({
  useChatAgents: () => ({
    agents: mockAgents,
  }),
}));

// Import after mocks are set up
const { useEffectiveAgent } = await import('../use-effective-agent');

const ORG_ID = 'org-1';

const AGENTS: MockAgent[] = [
  {
    name: 'chat-agent',
    displayName: 'Default Chat',
    description: 'Default assistant',
  },
  {
    name: 'custom-agent',
    displayName: 'Custom Agent',
    description: 'A custom agent',
  },
];

beforeEach(() => {
  mockSelectedAgent = null;
  mockAgents = undefined;
});

describe('useEffectiveAgent', () => {
  describe('when agents are loading', () => {
    it('returns null when no selected agent', () => {
      mockAgents = undefined;
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toBeNull();
    });

    it('returns null even when selected agent exists in localStorage', () => {
      mockAgents = undefined;
      mockSelectedAgent = { name: 'chat-agent', displayName: 'Default Chat' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toBeNull();
    });
  });

  describe('when agents are loaded', () => {
    it('returns default chat-agent when no selection', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        name: 'chat-agent',
        displayName: 'Default Chat',
      });
    });

    it('returns null when no agents exist', () => {
      mockAgents = [];
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toBeNull();
    });

    it('returns validated selected agent when it exists in list', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = { name: 'custom-agent', displayName: 'Custom Agent' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        name: 'custom-agent',
        displayName: 'Custom Agent',
      });
    });

    it('falls back to default when selected agent was deleted', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = {
        name: 'deleted-agent',
        displayName: 'Gone Agent',
      };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        name: 'chat-agent',
        displayName: 'Default Chat',
      });
    });

    it('updates displayName from server data', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = { name: 'custom-agent', displayName: 'Old Name' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        name: 'custom-agent',
        displayName: 'Custom Agent',
      });
    });

    it('falls back to first agent when no chat-agent default exists', () => {
      mockAgents = [
        {
          name: 'other-agent',
          displayName: 'Other Agent',
          description: '',
        },
      ];
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        name: 'other-agent',
        displayName: 'Other Agent',
      });
    });
  });
});
