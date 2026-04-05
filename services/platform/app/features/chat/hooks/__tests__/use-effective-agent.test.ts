// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SelectedAgent } from '../../context/chat-layout-context';

interface MockAgent {
  name: string;
  displayName: string;
  description: string;
  conversationStarters?: string[];
  i18n?: Record<
    string,
    { displayName?: string; conversationStarters?: string[] }
  >;
}

let mockSelectedAgent: SelectedAgent | null = null;
let mockAgents: MockAgent[] | undefined;
let mockLocale = 'en';
let mockOrgMetadata: unknown = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: mockLocale },
    t: (key: string) => key,
  }),
}));

vi.mock('../../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    selectedAgent: mockSelectedAgent,
  }),
}));

let mockIsLoading = false;

vi.mock('../queries', () => ({
  useChatAgents: () => ({
    agents: mockAgents,
    isLoading: mockIsLoading,
  }),
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({
    data:
      mockOrgMetadata !== undefined ? { metadata: mockOrgMetadata } : undefined,
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
  mockIsLoading = false;
  mockLocale = 'en';
  mockOrgMetadata = undefined;
});

describe('useEffectiveAgent', () => {
  describe('when agents are loading', () => {
    it('returns null agent with isLoading true when no selected agent', () => {
      mockAgents = undefined;
      mockIsLoading = true;
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({ agent: null, isLoading: true });
    });

    it('returns null agent even when selected agent exists in localStorage', () => {
      mockAgents = undefined;
      mockIsLoading = true;
      mockSelectedAgent = { name: 'chat-agent', displayName: 'Default Chat' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({ agent: null, isLoading: true });
    });
  });

  describe('when agents are loaded', () => {
    it('returns default chat-agent when no selection', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: { name: 'chat-agent', displayName: 'Default Chat' },
        isLoading: false,
      });
    });

    it('returns null agent when no agents exist', () => {
      mockAgents = [];
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({ agent: null, isLoading: false });
    });

    it('returns validated selected agent when it exists in list', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = { name: 'custom-agent', displayName: 'Custom Agent' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: { name: 'custom-agent', displayName: 'Custom Agent' },
        isLoading: false,
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
        agent: { name: 'chat-agent', displayName: 'Default Chat' },
        isLoading: false,
      });
    });

    it('updates displayName from server data', () => {
      mockAgents = AGENTS;
      mockSelectedAgent = { name: 'custom-agent', displayName: 'Old Name' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: { name: 'custom-agent', displayName: 'Custom Agent' },
        isLoading: false,
      });
    });

    it('includes conversationStarters from matched agent', () => {
      const starters = ['Hello', 'Help me'];
      mockAgents = [
        {
          name: 'chat-agent',
          displayName: 'Default Chat',
          description: 'Default assistant',
          conversationStarters: starters,
        },
      ];
      mockSelectedAgent = null;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: {
          name: 'chat-agent',
          displayName: 'Default Chat',
          conversationStarters: starters,
        },
        isLoading: false,
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
        agent: { name: 'other-agent', displayName: 'Other Agent' },
        isLoading: false,
      });
    });
  });

  describe('i18n locale resolution', () => {
    const I18N_AGENTS: MockAgent[] = [
      {
        name: 'chat-agent',
        displayName: 'Chat Agent',
        description: 'Default assistant',
        conversationStarters: ['Hello', 'Help me'],
        i18n: {
          de: {
            displayName: 'Chat-Assistent',
            conversationStarters: ['Hallo', 'Hilf mir'],
          },
        },
      },
    ];

    it('returns top-level fields when locale matches org default', () => {
      mockAgents = I18N_AGENTS;
      mockLocale = 'en';
      mockOrgMetadata = { defaultLocale: 'en' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: {
          name: 'chat-agent',
          displayName: 'Chat Agent',
          conversationStarters: ['Hello', 'Help me'],
        },
        isLoading: false,
      });
    });

    it('returns i18n overrides when locale differs from org default', () => {
      mockAgents = I18N_AGENTS;
      mockLocale = 'de';
      mockOrgMetadata = { defaultLocale: 'en' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: {
          name: 'chat-agent',
          displayName: 'Chat-Assistent',
          conversationStarters: ['Hallo', 'Hilf mir'],
        },
        isLoading: false,
      });
    });

    it('falls back to top-level when locale has no i18n overrides', () => {
      mockAgents = I18N_AGENTS;
      mockLocale = 'fr';
      mockOrgMetadata = { defaultLocale: 'en' };

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: {
          name: 'chat-agent',
          displayName: 'Chat Agent',
          conversationStarters: ['Hello', 'Help me'],
        },
        isLoading: false,
      });
    });

    it('defaults to en when org metadata is missing', () => {
      mockAgents = I18N_AGENTS;
      mockLocale = 'en';
      mockOrgMetadata = undefined;

      const { result } = renderHook(() => useEffectiveAgent(ORG_ID));

      expect(result.current).toEqual({
        agent: {
          name: 'chat-agent',
          displayName: 'Chat Agent',
          conversationStarters: ['Hello', 'Help me'],
        },
        isLoading: false,
      });
    });
  });
});
