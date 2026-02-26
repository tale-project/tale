import { useMemo } from 'react';

import type { SelectedAgent } from '../context/chat-layout-context';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from './queries';

/**
 * Resolves the currently effective agent for chat.
 *
 * When the user has explicitly selected an agent, returns that selection.
 * Otherwise, falls back to the organization's system default chat agent.
 */
export function useEffectiveAgent(
  organizationId: string,
): SelectedAgent | null {
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);

  return useMemo(() => {
    if (selectedAgent) {
      if (!agents) return null;
      const match = agents.find(
        (a) => (a.rootVersionId ?? a._id) === selectedAgent._id,
      );
      if (match) {
        const rootId = match.rootVersionId ?? match._id;
        return { _id: rootId, displayName: match.displayName };
      }
    }

    if (!agents) return null;

    const defaultAgent = agents.find(
      (a) => Boolean(a.isSystemDefault) && a.systemAgentSlug === 'chat',
    );
    if (!defaultAgent) return null;

    const rootId = defaultAgent.rootVersionId ?? defaultAgent._id;
    return { _id: rootId, displayName: defaultAgent.displayName };
  }, [selectedAgent, agents]);
}
