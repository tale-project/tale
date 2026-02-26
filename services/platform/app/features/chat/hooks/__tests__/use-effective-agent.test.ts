// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SelectedAgent } from '../../context/chat-layout-context';

interface MockAgent {
  _id: string;
  rootVersionId: string | null;
  displayName: string;
  description: string;
  isSystemDefault: boolean;
  systemAgentSlug: string | null;
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
    _id: 'agent-1',
    rootVersionId: null,
    displayName: 'Default Chat',
    description: 'Default assistant',
    isSystemDefault: true,
    systemAgentSlug: 'chat',
  },
  {
    _id: 'agent-2',
    rootVersionId: 'root-2',
    displayName: 'Custom Agent',
    description: 'A custom agent',
    isSystemDefault: false,
    systemAgentSlug: null,
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
      mockSelectedAgent = { _id: 'agent-1', displayName: 'Default Chat' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toBeNull();
    });
  });

  describe('when agents are loaded', () => {
    it('returns default chat agent when no selection', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        _id: 'agent-1',
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
      mockSelectedAgent = { _id: 'root-2', displayName: 'Custom Agent' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        _id: 'root-2',
        displayName: 'Custom Agent',
      });
    });

    it('falls back to default when selected agent was deleted', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = {
        _id: 'deleted-agent',
        displayName: 'Gone Agent',
      };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        _id: 'agent-1',
        displayName: 'Default Chat',
      });
    });

    it('uses rootVersionId when agent has one', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = { _id: 'root-2', displayName: 'Old Name' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        _id: 'root-2',
        displayName: 'Custom Agent',
      });
    });

    it('returns null when no default agent and no selection', () => {
      mockAgents = [
        {
          _id: 'agent-x',
          rootVersionId: null,
          displayName: 'Non-default',
          description: '',
          isSystemDefault: false,
          systemAgentSlug: null,
        },
      ];
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toBeNull();
    });
  });
});
