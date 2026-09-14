import { createI18n } from '@tale/e2e/i18n';

/**
 * Resolve UI labels from `messages/en.yml` so locators never hardcode English
 * literals (AGENTS.md i18n rule — the Playwright context pins `locale: 'en-US'`,
 * so the app renders the `en` catalog). Thin wrapper over the shared resolver
 * in `@tale/e2e`, pinned to this service's catalog merged over the `@tale/ui`
 * catalog — the same merge `initServiceI18n` performs at runtime, so a locator
 * can name a package key (`common.actions.delete`) exactly as the app does.
 */
const UI_MESSAGES = new URL(
  '../../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);

export const { t } = createI18n(
  new URL('../../../messages/en.yml', import.meta.url),
  {
    packages: [
      new URL('global.yml', UI_MESSAGES),
      new URL('en.yml', UI_MESSAGES),
    ],
  },
);
