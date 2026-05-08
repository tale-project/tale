export const MAX_CONVERSATION_STARTERS = 4;
export const MAX_CONVERSATION_STARTER_LENGTH = 200;

/** Locales for which an agent can ship localized metadata
 *  (display name, description, conversation starters, system instructions).
 *  Intentionally inlined (vs. re-exported from `@tale/i18n/locales`) because
 *  Convex's deploy bundler doesn't resolve workspace-package subpath exports
 *  through transitive re-exports — and `agents.ts` is reachable from convex
 *  code (e.g. `convex/agents/file_actions.ts`). Tracks the UI's
 *  `SUPPORTED_LOCALES` 1:1 today; if it ever diverges, the divergence is
 *  explicit here. */
export const SUPPORTED_AGENT_LOCALES = ['en', 'de', 'fr'] as const;

export const PROTECTED_AGENT_NAMES = [
  'chat-agent',
  'workflow-assistant',
] as const;
