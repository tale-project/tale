import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

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
 *
 * Translatable display fields (displayName, conversationStarters) resolve
 * against the user's current UI locale via `resolveAgentLocale`'s i18n-first
 * precedence — agent output language (systemInstructions) is a separate,
 * server-side concern driven by the org's defaultLocale.
 */
export function useEffectiveAgent(organizationId: string): {
  agent: EffectiveAgent | null;
  isLoading: boolean;
} {
  const { selectedAgent } = useChatLayout();
  const { agents, isLoading } = useChatAgents(organizationId);
  const { i18n } = useTranslation();

  const locale = i18n.language;

  const agent = useMemo(() => {
    function resolve(entry: NonNullable<typeof agents>[number]) {
      const resolved = resolveAgentLocale(entry, locale);
      return {
        name: entry.name,
        displayName: resolved.displayName,
        conversationStarters: resolved.conversationStarters,
      };
    }

    if (selectedAgent) {
      if (!agents) return null;
      const match = agents.find((a) => a.name === selectedAgent.name);
      if (match) return resolve(match);
    }

    if (!agents) return null;

    const defaultAgent = agents.find((a) => a.name === DEFAULT_CHAT_AGENT_NAME);
    if (defaultAgent) return resolve(defaultAgent);

    const firstAgent = agents[0];
    if (!firstAgent) return null;

    return resolve(firstAgent);
  }, [selectedAgent, agents, locale]);

  return { agent, isLoading };
}
