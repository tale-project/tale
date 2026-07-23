/**
 * Fuzzy catalog search — how authors discover capabilities without inline
 * catalog dumps: keyword scoring plus a synonym table, word-prefix matching,
 * and edit-distance-1 typo tolerance. Measured to strictly widen recall over
 * a plain keyword baseline while keeping exact matches ranked first.
 *
 * The scorer is exported as {@link rankFuzzy} because discovery is not unique
 * to the workflow catalog: chat's capability surface searches over the same
 * kind of "name + description + tags" documents, and a second matcher would
 * mean two different answers to the same query.
 */

import { nodeTypes, type NodeTypeDef } from '../core/slots';

export interface CatalogMatch {
  type: string;
  description: string;
  input_schema: Record<string, unknown>;
  output: string;
}

/**
 * One searchable thing, reduced to what scoring reads. `name` is the primary
 * identifier — a hit there outranks a hit anywhere in `body`, which carries
 * the description, tags, and any other prose worth matching.
 */
export interface FuzzyDocument {
  name: string;
  body?: string;
}

/** General synonym table — extend as the catalog grows. */
const SYNONYMS: Record<string, string[]> = {
  translate: ['translation', 'language', 'localize'],
  translation: ['translate', 'language'],
  sms: ['text', 'message', 'phone'],
  text: ['sms', 'message'],
  stock: ['inventory', 'warehouse'],
  inventory: ['stock', 'warehouse'],
  ticket: ['issue', 'support', 'helpdesk'],
  invoice: ['billing', 'finance'],
  billing: ['invoice', 'finance'],
  backup: ['snapshot', 'archive'],
  weather: ['forecast', 'temperature'],
  email: ['mail', 'message'],
  chat: ['slack', 'message'],
};

/** Whether two words are within one edit of each other. */
function lev1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Split a query into the terms worth scoring — single characters carry no
 * signal and would match almost everything. */
export function fuzzyQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Score one document against pre-split query terms. Zero means "no signal at
 * all" — callers drop those rather than showing an arbitrary tail.
 */
export function fuzzyScore(
  terms: readonly string[],
  doc: FuzzyDocument,
): number {
  const name = doc.name.toLowerCase();
  const words = `${doc.name} ${doc.body ?? ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let score = 0;
  for (const t of terms) {
    const expanded = [t, ...(SYNONYMS[t] ?? [])];
    let hit = 0;
    for (const e of expanded) {
      // Exact-term hits outrank synonym hits; name hits outrank body hits;
      // prefixes trail both.
      if (name.includes(e)) {
        hit = Math.max(hit, e === t ? 3 : 2);
      } else if (words.includes(e)) {
        hit = Math.max(hit, e === t ? 2 : 1);
      } else if (words.some((w) => w.startsWith(e) && e.length >= 3)) {
        hit = Math.max(hit, 1);
      }
    }
    if (hit === 0 && t.length >= 5 && words.some((w) => lev1(t, w))) {
      hit = 1;
    }
    score += hit;
  }
  return score;
}

/**
 * Rank `items` against `query`, best first, ties broken by name so results
 * are stable. Items scoring zero are dropped.
 */
export function rankFuzzy<T>(
  query: string,
  items: Iterable<T>,
  toDocument: (item: T) => FuzzyDocument,
  limit = 8,
): T[] {
  const terms = fuzzyQueryTerms(query);
  const scored: Array<{ score: number; name: string; item: T }> = [];
  for (const item of items) {
    const doc = toDocument(item);
    const score = fuzzyScore(terms, doc);
    if (score > 0) scored.push({ score, name: doc.name, item });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ item }) => item);
}

interface SearchableDef extends NodeTypeDef {
  integration: NonNullable<NodeTypeDef['integration']>;
}

function isSearchable(def: NodeTypeDef): def is SearchableDef {
  return def.kind === 'integration' && def.integration !== undefined;
}

export function searchCatalog(query: string, limit = 8): CatalogMatch[] {
  const searchable = [...nodeTypes().values()].filter(isSearchable);
  return rankFuzzy(
    query,
    searchable,
    (def) => ({
      name: def.type,
      body: `${def.description} ${(def.integration.tags ?? []).join(' ')}`,
    }),
    limit,
  ).map((def) => ({
    type: def.type,
    description: def.description,
    input_schema: def.integration.inputSchema,
    output: def.integration.outputSignature,
  }));
}

/** Every registered integration, for docs generation. */
export function allIntegrations() {
  return [...nodeTypes().values()].flatMap((d) =>
    d.kind === 'integration' && d.integration ? [d.integration] : [],
  );
}
