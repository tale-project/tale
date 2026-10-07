/**
 * Glossary loader. Reads `glossary.yml` once per process and exposes a
 * `GlossaryHandle` with category filters and locale-fallback-aware
 * `resolveForm` / `shouldEnforce`.
 *
 * The default `glossary.yml` ships alongside this loader; consumers can
 * pass a different path (used by `defineDocsTests` if a future repo
 * surfaces its own glossary).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import type { Category, Glossary, GlossaryHandle, Term } from './types';

const DEFAULT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'glossary.yml',
);

let cache: { path: string; handle: GlossaryHandle } | null = null;

function isGlossary(value: unknown): value is Glossary {
  return (
    typeof value === 'object' &&
    value !== null &&
    'terms' in value &&
    Array.isArray(value.terms)
  );
}

/** Load a glossary from disk and return its handle. Cached per path. */
export function loadGlossary(
  glossaryPath: string = DEFAULT_PATH,
): GlossaryHandle {
  if (cache && cache.path === glossaryPath) return cache.handle;
  const raw: unknown = parseYaml(fs.readFileSync(glossaryPath, 'utf8'));
  if (!isGlossary(raw)) {
    throw new Error(
      `Invalid glossary file at ${glossaryPath}: expected an object with a "terms" array.`,
    );
  }
  const handle = buildHandle(raw);
  cache = { path: glossaryPath, handle };
  return handle;
}

function buildHandle(glossary: Glossary): GlossaryHandle {
  const byCat = new Map<Category, Term[]>();
  for (const term of glossary.terms) {
    let list = byCat.get(term.category);
    if (!list) {
      list = [];
      byCat.set(term.category, list);
    }
    list.push(term);
  }

  return {
    all: glossary.terms,
    byCategory(category) {
      return byCat.get(category) ?? [];
    },
    resolveForm(term, locale) {
      const lookup: Record<string, string | undefined> = {
        en: term.en,
        de: term.de,
        fr: term.fr,
        de_CH: term.de_CH,
      };
      const direct = lookup[localeKey(locale)];
      if (typeof direct === 'string') return direct;
      // Fallback chain: de-CH → de → en (handled by the de_CH key normalization).
      if (locale === 'de-CH' && typeof term.de === 'string') return term.de;
      return term.en;
    },
    shouldEnforce(term, locale) {
      if (term._lintExclude?.[locale] === true) return false;
      const form = this.resolveForm(term, locale);
      return form !== term.en;
    },
  };
}

/** Locale id → object-key normalisation (`de-CH` → `de_CH`). */
function localeKey(locale: string): string {
  return locale.replaceAll('-', '_');
}
