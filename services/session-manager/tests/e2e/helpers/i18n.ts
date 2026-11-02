import { createI18n } from '@tale/e2e/i18n';

/**
 * Resolve UI labels from `messages/en/` so locators never hardcode English
 * literals (the Playwright context pins `locale: 'en-US'`, so the app renders
 * the `en` catalog). The service's catalog is merged over the `@tale/ui` one,
 * as `initServiceI18n` does at runtime, so a locator can name a package key
 * (`common.actions.delete`) exactly as the app does.
 *
 * `t` does not interpolate: `fill(t('sessions.count'), { count: 5 })` puts
 * values into a simple `{name}` argument. A plural message is matched with a
 * pattern built from its other words instead.
 */
const UI_MESSAGES = new URL(
  '../../../../../packages/ui/src/i18n/messages/',
  import.meta.url,
);

export const { t } = createI18n(
  new URL('../../../messages/en/', import.meta.url),
  {
    packages: [
      new URL('global.yml', UI_MESSAGES),
      new URL('en.yml', UI_MESSAGES),
    ],
  },
);

/** A message with its `{name}` arguments replaced. */
export function fill(
  message: string,
  values: Record<string, string | number>,
): string {
  return message.replaceAll(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

/** A pattern that matches `text` as it is, not as an expression. */
export function literally(text: string): RegExp {
  return new RegExp(text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
}
