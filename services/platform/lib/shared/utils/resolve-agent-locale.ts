import type { AgentI18nOverrides } from '../../../convex/agents/file_utils';
import { defaultLocale as appDefaultLocale } from '../../i18n/config';
import { narrowBcp47 } from './narrow-bcp47';
import { pickField } from './pick-field';

interface LocalizableAgent {
  displayName?: string;
  description?: string;
  conversationStarters?: string[];
  systemInstructions?: string;
  i18n?: Record<string, AgentI18nOverrides>;
}

interface ResolvedFields {
  displayName: string;
  description?: string;
  conversationStarters?: string[];
  systemInstructions?: string;
}

/**
 * Resolves locale-specific agent fields with i18n-first precedence:
 *   1. `i18n[requestedLocale].<field>`
 *   2. `i18n[baseLanguage].<field>` — e.g. `de-CH` narrows to `de`
 *   3. `i18n[appDefault='en'].<field>`
 *   4. top-level `<field>` (legacy fallback for pre-i18n agents)
 *
 * `displayName` is required on return — if unset at every layer (which should
 * not happen given the schema refinement), falls back to an empty string.
 */
export function resolveAgentLocale(
  agent: LocalizableAgent,
  locale: string,
): ResolvedFields {
  const base = narrowBcp47(locale);

  const direct = agent.i18n?.[locale];
  const baseI18n = base ? agent.i18n?.[base] : undefined;
  const fallbackI18n =
    locale !== appDefaultLocale && base !== appDefaultLocale
      ? agent.i18n?.[appDefaultLocale]
      : undefined;

  return {
    displayName:
      pickField([
        direct?.displayName,
        baseI18n?.displayName,
        fallbackI18n?.displayName,
        agent.displayName,
      ]) ?? '',
    description: pickField([
      direct?.description,
      baseI18n?.description,
      fallbackI18n?.description,
      agent.description,
    ]),
    conversationStarters: pickField([
      direct?.conversationStarters,
      baseI18n?.conversationStarters,
      fallbackI18n?.conversationStarters,
      agent.conversationStarters,
    ]),
    systemInstructions: pickField([
      direct?.systemInstructions,
      baseI18n?.systemInstructions,
      fallbackI18n?.systemInstructions,
      agent.systemInstructions,
    ]),
  };
}
