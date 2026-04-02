import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import { getOrganizationDefaultLocale } from '@/lib/shared/utils/get-organization-default-locale';
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
 * Translatable fields (displayName, conversationStarters) are resolved
 * based on the user's current locale and the organization's default locale.
 */
export function useEffectiveAgent(
  organizationId: string,
): EffectiveAgent | null {
  const { selectedAgent } = useChatLayout();
  const { agents } = useChatAgents(organizationId);
  const { i18n } = useTranslation();
  const { data: organization } = useOrganization(organizationId);

  const locale = i18n.language;
  const defaultLocale = getOrganizationDefaultLocale(organization?.metadata);

  return useMemo(() => {
    function resolve(agent: NonNullable<typeof agents>[number]) {
      const resolved = resolveAgentLocale(agent, locale, defaultLocale);
      return {
        name: agent.name,
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

    // Fall back to first available agent
    const firstAgent = agents[0];
    if (!firstAgent) return null;

    return resolve(firstAgent);
  }, [selectedAgent, agents, locale, defaultLocale]);
}
