/**
 * Near misses: the page a guessed documentation address most likely meant.
 *
 * Readers and language models guess addresses instead of following links. A
 * model answering in German writes `/de/verwaltung/mitglieder-und-rollen` —
 * the German title of `platform/admin/members-and-roles`, slugified, under a
 * translated folder — or shortens `…/configuration/retention` to
 * `…/configuration/retention-limits`. A guess is scored against every page's
 * slug and its titles in every locale: the 404 page lists the closest pages
 * as "did you mean", and a docs server redirects a guess to the one page that
 * clearly wins, so an agent that cannot read a 404 page still lands.
 *
 * Deliberately conservative: an exact alias (the page's last segment, a
 * slugified title, a generic `overview` under a section) resolves; a fuzzy
 * match only when it beats every other page by a margin. Everything else
 * stays a 404 with suggestions.
 */

import { redirectLocation } from './redirects';

export interface NearMissPage {
  /** Locale-less route, e.g. `platform/admin/members-and-roles` (`''` = home). */
  route: string;
  /** The page's titles and sidebar labels, in every locale it ships. */
  titles: readonly string[];
}

interface IndexedPage {
  route: string;
  position: number;
  segments: readonly string[];
  leaf: string;
  tokens: ReadonlySet<string>;
}

export interface NearMissIndex {
  readonly pages: readonly IndexedPage[];
  readonly byRoute: ReadonlyMap<string, IndexedPage>;
  /** Folded title slug (`mitglieder-und-rollen`) → routes carrying it. */
  readonly titleSlugs: ReadonlyMap<string, ReadonlySet<string>>;
  /** Stopword-free, stemmed title tokens (`create-import-automation`) → routes. */
  readonly titleKeys: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface NearMissCandidate {
  route: string;
  score: number;
}

// Function words in the three documentation languages. Dropped before
// scoring so "create or import an automation" and "create-import-automations"
// compare on the words that carry meaning.
const STOPWORDS: ReadonlySet<string> = new Set([
  // en
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'with',
  'you',
  'your',
  // de
  'am',
  'auf',
  'bei',
  'dein',
  'deine',
  'dem',
  'den',
  'der',
  'des',
  'die',
  'das',
  'du',
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'fur',
  'im',
  'mit',
  'oder',
  'und',
  'von',
  'zu',
  'zum',
  'zur',
  // fr
  'au',
  'aux',
  'avec',
  'dans',
  'de',
  'du',
  'en',
  'et',
  'l',
  'la',
  'le',
  'les',
  'ou',
  'pour',
  'sur',
  'ta',
  'tes',
  'ton',
  'un',
  'une',
  'vos',
  'votre',
]);

/** Leaves that name a section's front page rather than a page of their own. */
const GENERIC_LEAVES: ReadonlySet<string> = new Set([
  'about',
  'getting-started',
  'home',
  'index',
  'intro',
  'introduction',
  'main',
  'overview',
  'readme',
  'start',
]);

/** Accents off, `ß` spelled out, lower case: `Übersicht` → `ubersicht`. */
function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss');
}

function words(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A crude plural fold. Both the guess and the page go through it, so it only
 * has to map a word and its plural onto the same stem, in any of the three
 * languages: `automations` → `automation`, `automatisierungen` →
 * `automatisierung`.
 */
function stem(word: string): string {
  if (word.length > 6 && word.endsWith('en')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

function meaningful(text: string): string[] {
  return words(text)
    .filter((word) => !STOPWORDS.has(word))
    .map(stem);
}

function addTo(
  map: Map<string, Set<string>>,
  key: string,
  route: string,
): void {
  if (!key) return;
  const routes = map.get(key) ?? new Set<string>();
  routes.add(route);
  map.set(key, routes);
}

/** Index the pages once; `pages` in reading order (ties rank by it). */
export function buildNearMissIndex(
  pages: readonly NearMissPage[],
): NearMissIndex {
  const indexed: IndexedPage[] = [];
  const byRoute = new Map<string, IndexedPage>();
  const titleSlugs = new Map<string, Set<string>>();
  const titleKeys = new Map<string, Set<string>>();
  for (const page of pages) {
    if (byRoute.has(page.route)) continue;
    const segments = page.route ? page.route.split('/') : [];
    const tokens = new Set<string>([
      ...segments.flatMap(meaningful),
      ...page.titles.flatMap(meaningful),
    ]);
    const entry: IndexedPage = {
      route: page.route,
      position: indexed.length,
      segments,
      leaf: segments.at(-1) ?? '',
      tokens,
    };
    indexed.push(entry);
    byRoute.set(page.route, entry);
    for (const title of page.titles) {
      addTo(titleSlugs, words(title).join('-'), page.route);
      addTo(titleKeys, meaningful(title).join('-'), page.route);
    }
  }
  return { pages: indexed, byRoute, titleSlugs, titleKeys };
}

/** Iterative Levenshtein distance between two short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr.push(Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * How well one guessed word is covered by a page: the word itself, a
 * prefix of it or the other way round (`aufbewahrung` ⊂
 * `aufbewahrungsgrenzen`), or one typo away.
 */
function wordCredit(word: string, tokens: ReadonlySet<string>): number {
  if (tokens.has(word)) return 1;
  let best = 0;
  for (const token of tokens) {
    if (
      word.length >= 4 &&
      token.length >= 4 &&
      (token.startsWith(word) || word.startsWith(token))
    ) {
      best = Math.max(best, 0.75);
    } else if (
      word.length >= 5 &&
      Math.abs(word.length - token.length) <= 2 &&
      levenshtein(word, token) <= (word.length >= 8 ? 2 : 1)
    ) {
      best = Math.max(best, 0.7);
    }
  }
  return best;
}

/** Longest guess considered; anything longer is not a mistyped address. */
const MAX_QUERY_LENGTH = 240;
/** Most words scored from a guess, so a crafted address costs no more. */
const MAX_QUERY_WORDS = 12;

interface ParsedQuery {
  segments: string[];
  leafWords: string[];
  folderWords: string[];
}

function parseQuery(query: string): ParsedQuery | null {
  if (query.length > MAX_QUERY_LENGTH) return null;
  const segments = query
    .split('/')
    .map((segment) => words(segment).join('-'))
    .filter(Boolean);
  if (segments.length === 0) return null;
  const leafWords = meaningful(segments.at(-1) ?? '').slice(0, MAX_QUERY_WORDS);
  const folderWords = [...new Set(segments.slice(0, -1).flatMap(meaningful))]
    .filter((word) => !leafWords.includes(word))
    .slice(0, Math.max(0, MAX_QUERY_WORDS - leafWords.length));
  return { segments, leafWords, folderWords };
}

function scorePage(
  parsed: ParsedQuery,
  page: IndexedPage,
): { score: number; leafCredit: number } {
  let leafCredit = 0;
  for (const word of parsed.leafWords) {
    leafCredit += wordCredit(word, page.tokens);
  }
  let folderCredit = 0;
  for (const word of parsed.folderWords) {
    folderCredit += wordCredit(word, page.tokens);
  }
  const weight = 2 * parsed.leafWords.length + parsed.folderWords.length;
  return {
    score: weight === 0 ? 0 : (2 * leafCredit + folderCredit) / weight,
    leafCredit,
  };
}

/**
 * Every page scored against a guessed route, best first; ties keep the
 * reading order. An empty guess — the site root's 404 — is the reading
 * order itself.
 */
export function rankNearMisses(
  query: string,
  index: NearMissIndex,
): NearMissCandidate[] {
  const parsed = parseQuery(query);
  if (!parsed) return index.pages.map(({ route }) => ({ route, score: 0 }));
  return index.pages
    .map((page) => ({ page, score: scorePage(parsed, page).score }))
    .sort((a, b) => b.score - a.score || a.page.position - b.page.position)
    .map(({ page, score }) => ({ route: page.route, score }));
}

/** The one route in `routes`, or null when there are none or several. */
function only(routes: ReadonlySet<string> | undefined): string | null {
  if (!routes || routes.size !== 1) return null;
  const [route] = routes;
  return route ?? null;
}

/** How many of the guess's folder segments a page's route shares. */
function folderOverlap(parsed: ParsedQuery, page: IndexedPage): number {
  const folders = new Set(page.segments.slice(0, -1));
  return parsed.segments.slice(0, -1).filter((segment) => folders.has(segment))
    .length;
}

/** The single best of `pages` by folder overlap, or null on a tie. */
function bestByFolders(
  parsed: ParsedQuery,
  pages: readonly IndexedPage[],
): string | null {
  if (pages.length === 1) return pages[0]?.route ?? null;
  const ranked = pages
    .map((page) => ({ page, overlap: folderOverlap(parsed, page) }))
    .sort((a, b) => b.overlap - a.overlap);
  const [first, second] = ranked;
  if (!first || (second && second.overlap === first.overlap)) return null;
  return first.page.route;
}

/** A section's front page: the page at `route`, else the first under it. */
function sectionPage(route: string, index: NearMissIndex): string | null {
  if (index.byRoute.has(route)) return route;
  const prefix = route ? `${route}/` : '';
  return (
    index.pages.find((page) => page.route.startsWith(prefix))?.route ?? null
  );
}

/** Minimum fuzzy score a guess needs, and its lead over the runner-up. */
const MIN_SCORE = 0.6;
const MIN_MARGIN = 0.15;

/**
 * The page a guessed route unambiguously means, or null when no page clearly
 * wins. `query` is locale-less and carries no mount prefix or extension
 * (`verwaltung/mitglieder-und-rollen`).
 */
export function resolveNearMiss(
  query: string,
  index: NearMissIndex,
): string | null {
  const parsed = parseQuery(query);
  if (!parsed) return null;
  const route = parsed.segments.join('/');
  if (index.byRoute.has(route)) return route;
  const leaf = parsed.segments.at(-1) ?? '';

  // `/platform/overview`, `/self-hosted/install/introduction`: the section.
  if (GENERIC_LEAVES.has(leaf) && parsed.segments.length > 1) {
    const section = sectionPage(parsed.segments.slice(0, -1).join('/'), index);
    if (section !== null) return section;
  }

  // The page's own last segment under a guessed or moved folder.
  const sameLeaf = index.pages.filter((page) => page.leaf === leaf);
  if (sameLeaf.length > 0) {
    const picked = bestByFolders(parsed, sameLeaf);
    if (picked !== null) return picked;
  }

  // A title slugified, in any language the page ships.
  const byTitle =
    only(index.titleSlugs.get(leaf)) ??
    only(index.titleKeys.get(parsed.leafWords.join('-')));
  if (byTitle !== null) return byTitle;

  if (parsed.leafWords.length === 0) return null;
  let best: { route: string; score: number } | null = null;
  let runnerUp = 0;
  for (const page of index.pages) {
    const { score, leafCredit } = scorePage(parsed, page);
    if (leafCredit === 0) continue;
    if (!best || score > best.score) {
      runnerUp = best?.score ?? runnerUp;
      best = { route: page.route, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }
  if (!best || best.score < MIN_SCORE || best.score - runnerUp < MIN_MARGIN) {
    return null;
  }
  return best.route;
}

/** Extensions an address can carry and still name a page. */
const PAGE_EXTENSIONS = /\.(?:md|mdx|html?)$/i;

export interface MissingAddressSite {
  /** Locale segments the site serves a tree under (`['de', 'fr']`; `[]`). */
  prefixedLocales: readonly string[];
  /** The locale at the root, answered for an unprefixed address. */
  defaultLocale: string;
  /**
   * Locale segments an address may carry although the site serves no tree
   * for them (`de`, `fr` on a one-language site): dropped, never guessed at.
   */
  strayLocales?: readonly string[];
  /** Mount segment every page lives under (`docs` for `/docs/…`), if any. */
  mount?: string;
  /** Site-relative path of a route in a locale. */
  pagePath: (locale: string, route: string) => string;
  /** Whether the route is a page in that locale. */
  isPage: (locale: string, route: string) => boolean;
  /** Where a moved page or section folder's path redirects, if it does. */
  redirectFor: (path: string) => string | undefined;
  /** Titles and slugs every guess is scored against. */
  index: NearMissIndex;
}

export interface MissingAddressAnswer {
  /** Site-relative path or absolute URL to send the reader to. */
  location: string;
  /** A normalized address (301) or a guess (302, never cached for good). */
  permanent: boolean;
}

/** `de`, `DE`, `de-CH`, `de_ch` → `de` when the site serves `de`. */
function localeOf(
  segment: string,
  site: MissingAddressSite,
): string | undefined {
  const base = segment.toLowerCase().split(/[-_]/)[0] ?? '';
  if (!/^[a-z]{2}(?:[-_][a-z0-9]{2,8})?$/i.test(segment)) return undefined;
  if (site.prefixedLocales.includes(base)) return base;
  if (base === site.defaultLocale || site.strayLocales?.includes(base)) {
    return site.defaultLocale;
  }
  return undefined;
}

/**
 * The answer to an address that names no page, redirect or file: a
 * normalized spelling of a real address (a retired regional tree like
 * `/de-CH/…`, capitals, a trailing `index`, `.html`) is a 301; a near miss
 * is a 302; anything else is null and the site answers its 404. Asset-like
 * paths are never guessed at — a stale script chunk must stay a 404.
 */
export function resolveMissingAddress(
  pathname: string,
  site: MissingAddressSite,
): MissingAddressAnswer | null {
  if (pathname.length > MAX_QUERY_LENGTH + 40) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\\]/.test(decoded)) return null;
  const segments = decoded.split('/').filter(Boolean);
  const last = segments.at(-1) ?? '';
  const markdown = /\.md$/i.test(last);
  if (/\.[a-z0-9]{1,8}$/i.test(last) && !PAGE_EXTENSIONS.test(last)) {
    return null;
  }
  if (segments.length > 0) {
    segments[segments.length - 1] = last.replace(PAGE_EXTENSIONS, '');
  }

  let locale = site.defaultLocale;
  let localeSeen = false;
  while (segments.length > 0) {
    const candidate = localeOf(segments[0] ?? '', site);
    if (candidate === undefined) break;
    if (!localeSeen) locale = candidate;
    localeSeen = true;
    segments.shift();
  }
  if (site.mount && segments[0]?.toLowerCase() === site.mount) {
    segments.shift();
  }
  while (segments.at(-1)?.toLowerCase() === 'index') segments.pop();
  // Pages are lower case, but a redirect source keeps the spelling that was
  // published (`workflows/REFACTORING_SUMMARY`), so try both.
  const spelled = segments.join('/');
  const route = spelled.toLowerCase();

  const withExport = (path: string) =>
    markdown && !/^https?:/.test(path)
      ? path === '/'
        ? '/index.md'
        : `${path}.md`
      : path;
  const answer = (location: string, permanent: boolean) =>
    location === pathname ? null : { location, permanent };

  if (site.isPage(locale, route)) {
    return answer(withExport(site.pagePath(locale, route)), true);
  }
  const moved =
    site.redirectFor(site.pagePath(locale, spelled)) ??
    site.redirectFor(site.pagePath(locale, route));
  if (moved !== undefined) return answer(withExport(moved), true);

  const guess = resolveNearMiss(route, site.index);
  if (guess === null || !site.isPage(locale, guess)) return null;
  return answer(withExport(site.pagePath(locale, guess)), false);
}

interface NearMissRouteOptions {
  /** The site's answer to a missing address (`resolveMissingAddress`). */
  resolve: (pathname: string) => MissingAddressAnswer | null;
  /** Public mount prefix without a trailing slash (`''` or `/docs`). */
  basePath: string;
}

/**
 * The server hook (`startReactServer`'s `resolveNotFound`) for a docs site: a
 * normalized spelling of a real address answers a 301, a guess a 302 to the
 * page that clearly wins, both under the mount prefix with the query kept;
 * anything else — and any method but GET and HEAD — the 404 page.
 */
export function createNearMissRoute({
  resolve,
  basePath,
}: NearMissRouteOptions): (request: Request, url: URL) => Response | null {
  return (request, url) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const answer = resolve(url.pathname);
    if (!answer) return null;
    return new Response(null, {
      status: answer.permanent ? 301 : 302,
      headers: {
        Location: redirectLocation(answer.location, basePath, url.search),
      },
    });
  };
}
