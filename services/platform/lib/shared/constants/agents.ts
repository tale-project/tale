import { SUPPORTED_LOCALES } from '@tale/i18n/locales';

export const MAX_CONVERSATION_STARTERS = 4;
export const MAX_CONVERSATION_STARTER_LENGTH = 200;

/** The locales for which an agent can ship localized metadata
 *  (display name, description, conversation starters, system instructions).
 *  Tracks the UI's `SUPPORTED_LOCALES` 1:1 today — re-exported here so the
 *  agent-localization layer has its own named constant if the two ever
 *  diverge (e.g. agents support more locales than the marketing site). */
export const SUPPORTED_AGENT_LOCALES = SUPPORTED_LOCALES;

export const PROTECTED_AGENT_NAMES = [
  'chat-agent',
  'workflow-assistant',
] as const;
