import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

/**
 * Resolve UI labels from a service's `messages/en.json` so locators never
 * hardcode English literals (AGENTS.md i18n rule). Every frontend service
 * pins `locale: 'en-US'` in its Playwright config, so the app renders the `en`
 * catalog and these lookups match the rendered text. Each service builds its
 * own resolver pointed at its own catalog, e.g.
 * `createI18n(new URL('../../../messages/en.json', import.meta.url))`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface I18nResolver {
  /** Look up a dot-path key (e.g. `chat.send`) in the catalog. */
  t: (key: string) => string;
}

export function createI18n(messagesLocation: URL | string): I18nResolver {
  const parsed: unknown = parseYaml(readFileSync(messagesLocation, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(
      `messages JSON did not parse to an object: ${messagesLocation.toString()}`,
    );
  }
  const messages: Record<string, unknown> = parsed;

  const t = (key: string): string => {
    let node: unknown = messages;
    for (const part of key.split('.')) {
      if (!isRecord(node)) {
        throw new Error(`Missing messages key: ${key} (failed at "${part}")`);
      }
      node = node[part];
    }
    if (typeof node !== 'string') {
      throw new Error(`messages key is not a string: ${key}`);
    }
    return node;
  };

  return { t };
}
