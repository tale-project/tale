/**
 * Locales for which an agent can ship localized metadata (display name,
 * description, instructions). Tracks the UI's `SUPPORTED_LOCALES` 1:1 today;
 * if it ever diverges, the divergence is explicit here.
 */
export const SUPPORTED_AGENT_LOCALES = ['en', 'de', 'fr'] as const;
