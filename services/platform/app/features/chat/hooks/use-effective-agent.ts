import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/app/hooks/use-convex-auth';
import { DEFAULT_CHAT_AGENT_SLUG } from '@/lib/shared/constants/agents';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';

import type { SelectedAgent } from '../context/chat-layout-context';
import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from './queries';

export interface EffectiveAgent extends SelectedAgent {
  conversationStarters?: string[];
}

/**
 * Resolves the currently effective agent for chat.
 *
 * When the user has explicitly selected an agent, returns that selection.
 * Otherwise, falls back to the default assistant slug (`DEFAULT_CHAT_AGENT_SLUG`).
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
  const { isLoading: isAuthLoading } = useAuth();
  const { i18n } = useTranslation();

  const locale = i18n.language;

  const agent = useMemo(() => {
    if (!agents) return null;

    function resolve(entry: NonNullable<typeof agents>[number]) {
      const resolved = resolveAgentLocale(entry, locale);
      return {
        name: entry.name,
        displayName: resolved.displayName,
        conversationStarters: resolved.conversationStarters,
      };
    }

    // Honor an explicit pin first, then the org's default assistant, then any
    // agent at all — never invent one when the org has none.
    const match = selectedAgent
      ? agents.find((a) => a.name === selectedAgent.name)
      : undefined;
    const fallback =
      agents.find((a) => a.name === DEFAULT_CHAT_AGENT_SLUG) ?? agents[0];

    const resolvedAgent = match ?? fallback;
    return resolvedAgent ? resolve(resolvedAgent) : null;
  }, [selectedAgent, agents, locale]);

  // While auth is loading, the localStorage key (which embeds user.userId) is
  // org-scoped and won't match the real user-scoped entry — so `selectedAgent`
  // would falsely look null and we'd render the default-assistant fallback for
  // one frame. Treat that window as "agent not yet known" instead.
  if (isAuthLoading) {
    return { agent: null, isLoading: true };
  }

  return { agent, isLoading };
}
