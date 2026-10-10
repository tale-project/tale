import { readdirSync, readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { isRecord } from '../../../lib/utils/type-utils';

/**
 * The platform's message catalogs (`services/platform/messages/<locale>/`, one
 * file per topic), read once per locale — the same files the app renders, for
 * the few places the server must use the interface's own words: the
 * notification mirror, and the chat's hand-over note, which quotes the
 * controls a person sees.
 */

const CATALOG_LOCALES = ['en', 'de', 'fr', 'de-CH'] as const;
type CatalogLocale = (typeof CATALOG_LOCALES)[number];

const catalogs = new Map<CatalogLocale, Record<string, unknown>>();

function isCatalogLocale(value: string): value is CatalogLocale {
  return (CATALOG_LOCALES as readonly string[]).includes(value);
}

/** One locale's whole catalog; an unknown locale reads the English one. */
export function messageCatalog(locale: string): Record<string, unknown> {
  const supported: CatalogLocale = isCatalogLocale(locale) ? locale : 'en';
  let loaded = catalogs.get(supported);
  if (loaded === undefined) {
    loaded = readCatalog(supported);
    catalogs.set(supported, loaded);
  }
  return loaded;
}

/** A locale's topic files (`<topic>.yml`), each under its topic's name; a
 * regional overlay has only the topics it overrides. */
function readCatalog(locale: CatalogLocale): Record<string, unknown> {
  const dir = new URL(`../../../messages/${locale}/`, import.meta.url);
  const catalog: Record<string, unknown> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yml')) continue;
    const parsed: unknown = parse(readFileSync(new URL(file, dir), 'utf8'));
    catalog[file.slice(0, -'.yml'.length)] = isRecord(parsed) ? parsed : {};
  }
  return catalog;
}

/** The catalogs a locale reads, most specific first: a region falls back to
 * its language (`de-DE` → `de`, `de-CH` → its overlay, then `de`), every
 * locale to English. */
function catalogChain(locale: string): CatalogLocale[] {
  const chain: CatalogLocale[] = [];
  if (isCatalogLocale(locale)) chain.push(locale);
  const language = locale.split('-')[0] ?? '';
  if (isCatalogLocale(language) && !chain.includes(language)) {
    chain.push(language);
  }
  if (!chain.includes('en')) chain.push('en');
  return chain;
}

/** One string at a dotted `path` (`tasks.actions.create`) in the locale's
 * chain; undefined when not even English has it. */
export function catalogString(
  locale: string,
  path: string,
): string | undefined {
  const keys = path.split('.');
  for (const candidate of catalogChain(locale)) {
    let node: unknown = messageCatalog(candidate);
    for (const key of keys) {
      node = isRecord(node) ? node[key] : undefined;
    }
    if (typeof node === 'string') return node;
  }
  return undefined;
}
