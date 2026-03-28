import { useMemo } from 'react';

import type { SelectedAgent } from '../context/chat-layout-context';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from './queries';

export interface EffectiveAgent extends SelectedAgent {
  conversationStarters?: string[];
}

const DEFAULT_CHAT_AGENT_NAME = 'chat-agent';

/**
 * Resolves the currently effective agent for chat.
 *
 * When the user has explicitly selected an agent, returns that selection.
 * Otherwise, falls back to the hardcoded default 'chat-agent' filename.
 */
export function useEffectiveAgent(
  organizationId: string,
): EffectiveAgent | null {
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);

  return useMemo(() => {
    if (selectedAgent) {
      if (!agents) return null;
      const match = agents.find((a) => a.name === selectedAgent.name);
      if (match) {
        return {
          name: match.name,
          displayName: match.displayName,
          conversationStarters: match.conversationStarters,
        };
      }
    }

    if (!agents) return null;

    const defaultAgent = agents.find((a) => a.name === DEFAULT_CHAT_AGENT_NAME);
    if (defaultAgent) {
      return {
        name: defaultAgent.name,
        displayName: defaultAgent.displayName,
        conversationStarters: defaultAgent.conversationStarters,
      };
    }

    // Fall back to first available agent
    const firstAgent = agents[0];
    if (!firstAgent) return null;

    return {
      name: firstAgent.name,
      displayName: firstAgent.displayName,
      conversationStarters: firstAgent.conversationStarters,
    };
  }, [selectedAgent, agents]);
}
