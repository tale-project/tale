/**
 * Glossary loader. Reads `glossary.json` once per process and exposes a
 * `GlossaryHandle` with category filters and locale-fallback-aware
 * `resolveForm` / `shouldEnforce`.
 *
 * The default `glossary.json` ships alongside this loader; consumers can
 * pass a different path (used by `defineDocsTests` if a future repo
 * surfaces its own glossary).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Category, Glossary, GlossaryHandle, Term } from './types';

const DEFAULT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'glossary.json',
);

let cache: { path: string; handle: GlossaryHandle } | null = null;

/** Load a glossary from disk and return its handle. Cached per path. */
export function loadGlossary(
  glossaryPath: string = DEFAULT_PATH,
): GlossaryHandle {
  if (cache && cache.path === glossaryPath) return cache.handle;
  const raw: unknown = JSON.parse(fs.readFileSync(glossaryPath, 'utf8'));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const glossary = raw as Glossary;
  const handle = buildHandle(glossary);
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const lookup = term as unknown as Record<string, unknown>;
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
  return locale.replace('-', '_');
}
