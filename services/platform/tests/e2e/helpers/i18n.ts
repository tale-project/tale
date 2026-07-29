import { createI18n } from '@tale/e2e/i18n';

/**
 * Resolve UI labels from `messages/en.yml` so locators never hardcode English
 * literals (AGENTS.md i18n rule — the Playwright context pins `locale: 'en-US'`,
 * so the app renders the `en` catalog). Thin wrapper over the shared resolver
 * in `@tale/e2e`, pinned to this service's catalog.
 */
export const { t } = createI18n(
  new URL('../../../messages/en.yml', import.meta.url),
);
