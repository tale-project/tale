import { readFileSync } from 'node:fs';

import { parse as parseYaml } from 'yaml';

/**
 * Resolve UI labels from a service's `messages/en.yml` so locators never
 * hardcode English literals (AGENTS.md i18n rule). Every frontend service
 * pins `locale: 'en-US'` in its Playwright config, so the app renders the `en`
 * catalog and these lookups match the rendered text. Each service builds its
 * own resolver pointed at its own catalog, e.g.
 * `createI18n(new URL('../../../messages/en.yml', import.meta.url))`.
 *
 * A service that renders `@tale/ui` (or `@tale/marketing-ui`) components also
 * renders strings from the PACKAGE catalogs — `initServiceI18n` merges them
 * under the service's own keys at runtime. Pass those catalogs as `packages`
 * so a locator can name `common.actions.delete` the way the app resolves it;
 * the merge order is the runtime's: packages first, the service's own catalog
 * on top, so a key the service redeclares wins.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface I18nResolver {
  /** Look up a dot-path key (e.g. `chat.send`) in the catalog. */
  t: (key: string) => string;
}

export interface CreateI18nOptions {
  /**
   * Package catalogs (`packages/ui/src/i18n/messages/en.yml`, its
   * `global.yml`, …) merged beneath the service catalog, in order.
   */
  packages?: ReadonlyArray<URL | string>;
}

function readCatalog(location: URL | string): Record<string, unknown> {
  const parsed: unknown = parseYaml(readFileSync(location, 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error(
      `messages catalog did not parse to an object: ${location.toString()}`,
    );
  }
  return parsed;
}

/** Deep-merge `overlay` into `base`; the overlay wins per leaf key. */
function mergeCatalogs(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] =
      isRecord(existing) && isRecord(value)
        ? mergeCatalogs(existing, value)
        : value;
  }
  return out;
}

export function createI18n(
  messagesLocation: URL | string,
  options: CreateI18nOptions = {},
): I18nResolver {
  const messages = [...(options.packages ?? []), messagesLocation]
    .map(readCatalog)
    .reduce<Record<string, unknown>>(mergeCatalogs, {});

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
