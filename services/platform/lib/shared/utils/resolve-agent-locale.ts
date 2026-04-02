import type { AgentI18nOverrides } from '../../../convex/agents/file_utils';

interface LocalizableAgent {
  displayName: string;
  description?: string;
  conversationStarters?: string[];
  i18n?: Record<string, AgentI18nOverrides>;
}

interface ResolvedFields {
  displayName: string;
  description?: string;
  conversationStarters?: string[];
}

/**
 * Resolves locale-specific agent fields.
 *
 * If the user's locale matches the organization's default locale, returns
 * top-level values directly. Otherwise looks up i18n overrides for the locale,
 * falling back to top-level values for any missing fields.
 */
export function resolveAgentLocale(
  agent: LocalizableAgent,
  locale: string,
  defaultLocale: string,
): ResolvedFields {
  if (locale === defaultLocale) {
    return {
      displayName: agent.displayName,
      description: agent.description,
      conversationStarters: agent.conversationStarters,
    };
  }

  const overrides = agent.i18n?.[locale];
  return {
    displayName: overrides?.displayName ?? agent.displayName,
    description: overrides?.description ?? agent.description,
    conversationStarters:
      overrides?.conversationStarters ?? agent.conversationStarters,
  };
}
