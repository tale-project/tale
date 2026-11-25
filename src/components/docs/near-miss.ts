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
 * A sidebar section is guessed the same way, by the label the reader sees:
 * `/de/verwaltung` is the German label of the `platform/admin` group, which
 * no page carries as a title. The navigation's group labels, in every
 * locale, therefore name their section's front page, and count as the
 * folders of the pages under them (`/de/verwaltung/rollen`). A qualified
 * label must match the section's context. When added label context makes
 * fuzzy candidates ambiguous, a clear title/route match remains usable.
 *
 * A guess translates a whole path, not one segment: a model asking German
 * docs for `platform/knowledge/websites` writes
 * `/de/plattform/wissen/webseiten`. Each folder of a guess is therefore
 * placed on the site's own folders, by the folder's name or by its group's
 * label in any locale, and the pages under the folder it reaches are
 * searched before the rest of the site — so `plattform/agents` means the
 * Agents section, not the admin page that ends in `agents`.
 *
 * Deliberately conservative: an exact alias (the page's last segment, a
 * slugified title, a section's label, a generic `overview` under a section)
 * resolves; a fuzzy match only when it beats every other page by a margin.
 * On a site whose sections mostly open on an overview, a guess no page
 * clearly wins lands on the section its folders name (`/de/verwaltung/xyz`
 * → the admin overview). Everything else stays a 404 with suggestions.
 */

import { redirectLocation } from './redirects';

export interface NearMissPage {
  /** Locale-less route, e.g. `platform/admin/members-and-roles` (`''` = home). */
  route: string;
  /** The page's titles and sidebar labels, in every locale it ships. */
  titles: readonly string[];
}

/**
 * One sidebar group as a site's navigation stores it: a label, and the pages
 * and nested groups under it in reading order.
 */
export interface NearMissNavGroup {
  /** The group's sidebar label in every locale the site ships. */
  labels: readonly string[];
  /** Locale-less page routes and nested groups, in reading order. */
  entries: readonly (string | NearMissNavGroup)[];
}

interface IndexedPage {
  route: string;
  position: number;
  segments: readonly string[];
  leaf: string;
  tokens: ReadonlySet<string>;
  /** Each of the page's titles as its stopword-free, stemmed words. */
  titleWords: readonly (readonly string[])[];
  /** The labels of the sections above the page: folders a guess may name. */
  context: ReadonlySet<string>;
}

interface IndexedSection {
  /** The section's front page: the first page under it in reading order. */
  route: string;
  /** Where the section sits: the labels above it, its front page's folders. */
  context: ReadonlySet<string>;
}

export interface NearMissIndex {
  readonly pages: readonly IndexedPage[];
  readonly byRoute: ReadonlyMap<string, IndexedPage>;
  /** Folded title slug (`mitglieder-und-rollen`) → routes carrying it. */
  readonly titleSlugs: ReadonlyMap<string, ReadonlySet<string>>;
  /** Stopword-free, stemmed title tokens (`create-import-automation`) → routes. */
  readonly titleKeys: ReadonlyMap<string, ReadonlySet<string>>;
  /** Folded section label (`verwaltung`) → its sections, in reading order. */
  readonly sectionSlugs: ReadonlyMap<string, readonly IndexedSection[]>;
  /** Stopword-free, stemmed section label → its sections, in reading order. */
  readonly sectionKeys: ReadonlyMap<string, readonly IndexedSection[]>;
  /**
   * A name a guess may give a folder → the folders it names, in reading
   * order: the folder's own segment (`admin`) and the labels of the group
   * whose pages it holds, in every locale (`verwaltung`, `administration`),
   * each folded (`selbst-gehostet`) and as stemmed words (`automation`).
   */
  readonly folderNames: ReadonlyMap<string, readonly string[]>;
  /** A group's folder → the group's front page (`platform/admin/overview`). */
  readonly folderFronts: ReadonlyMap<string, string>;
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

/**
 * Leaves that name a section's front page rather than a page of their own,
 * in the three documentation languages and folded like a guess is
 * (`Übersicht` arrives as `ubersicht`, or spelled out as `uebersicht`).
 */
const GENERIC_LEAVES: ReadonlySet<string> = new Set([
  // en
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
  // de
  'einfuehrung',
  'einfuhrung',
  'startseite',
  'uberblick',
  'ubersicht',
  'ueberblick',
  'uebersicht',
  // fr
  'accueil',
  'apercu',
  'presentation',
]);

/**
 * Everyday words for English loanwords the documentation keeps: German
 * titles say `Websites` and `Connectors` where German prose, and a model
 * writing German, says `Webseiten` and `Konnektoren`, as French prose says
 * `connecteurs`. Folded like a guess is, and read on both sides.
 */
const LOANWORDS: ReadonlyMap<string, string> = new Map([
  // de
  ['konnektor', 'connector'],
  ['konnektoren', 'connectors'],
  ['webseite', 'website'],
  ['webseiten', 'websites'],
  // fr
  ['connecteur', 'connector'],
  ['connecteurs', 'connectors'],
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

/**
 * An umlaut spelled out the way an address spells it (`eintraege`,
 * `schluessel`) onto the bare vowel a folded title keeps (`eintrage`). The
 * page goes through it as well, so a word that merely contains the pair
 * (`request`) still meets itself.
 */
function unspell(word: string): string {
  return word.replace(/([aou])e/g, '$1');
}

function meaningful(text: string): string[] {
  return words(text)
    .map(unspell)
    .filter((word) => !STOPWORDS.has(word))
    .map((word) => stem(LOANWORDS.get(word) ?? word));
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

function addSection(
  map: Map<string, IndexedSection[]>,
  key: string,
  section: IndexedSection,
): void {
  if (!key) return;
  const sections = map.get(key) ?? [];
  // One label is often spelled alike in several locales (`Governance`).
  if (!sections.includes(section)) sections.push(section);
  map.set(key, sections);
}

/** The first page under a group, in reading order. */
function frontPage(group: NearMissNavGroup): string | undefined {
  for (const entry of group.entries) {
    const route = typeof entry === 'string' ? entry : frontPage(entry);
    if (route !== undefined) return route;
  }
  return undefined;
}

/** Every page route under a group, its nested groups' included. */
function routesUnder(group: NearMissNavGroup): string[] {
  return group.entries.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : routesUnder(entry),
  );
}

/**
 * The folder a group's pages share, `platform/admin` for the admin group, or
 * `''` when they share none. A group of one page holds the folder above it.
 */
function groupFolder(group: NearMissNavGroup): string {
  const [first, ...rest] = routesUnder(group).map((route) =>
    route ? route.split('/') : [],
  );
  if (first === undefined) return '';
  let shared = rest.length === 0 ? first.slice(0, -1) : first;
  for (const segments of rest) {
    let length = 0;
    while (length < shared.length && shared[length] === segments[length]) {
      length++;
    }
    shared = shared.slice(0, length);
  }
  return shared.join('/');
}

function depthOf(folder: string): number {
  return folder.split('/').length;
}

const NO_CONTEXT: ReadonlySet<string> = new Set();

/**
 * Index the pages once; `pages` in reading order (ties rank by it). `groups`
 * is the site's navigation: a group's labels name its front page, and count
 * as folders of every page under it.
 */
export function buildNearMissIndex(
  pages: readonly NearMissPage[],
  groups: readonly NearMissNavGroup[] = [],
): NearMissIndex {
  const sectionSlugs = new Map<string, IndexedSection[]>();
  const sectionKeys = new Map<string, IndexedSection[]>();
  const contextByRoute = new Map<string, Set<string>>();
  const walk = (group: NearMissNavGroup, above: readonly string[]) => {
    const front = frontPage(group);
    if (front !== undefined) {
      const section: IndexedSection = {
        route: front,
        context: new Set(
          [...above, ...front.split('/').slice(0, -1)].flatMap(meaningful),
        ),
      };
      for (const label of group.labels) {
        addSection(sectionSlugs, words(label).join('-'), section);
        addSection(sectionKeys, meaningful(label).join('-'), section);
      }
    }
    const here = [...above, ...group.labels];
    for (const entry of group.entries) {
      if (typeof entry !== 'string') {
        walk(entry, here);
        continue;
      }
      const context = contextByRoute.get(entry) ?? new Set<string>();
      for (const word of here.flatMap(meaningful)) context.add(word);
      contextByRoute.set(entry, context);
    }
  };
  for (const group of groups) walk(group, []);

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
      titleWords: page.titles.map(meaningful),
      context: contextByRoute.get(page.route) ?? NO_CONTEXT,
    };
    indexed.push(entry);
    byRoute.set(page.route, entry);
    for (const title of page.titles) {
      addTo(titleSlugs, words(title).join('-'), page.route);
      addTo(titleKeys, meaningful(title).join('-'), page.route);
    }
  }

  // Every folder a page sits in, named by its own segment and by the labels
  // of the group whose pages it holds; the pages come in reading order, so
  // each name lists its folders in that order.
  const folderNames = new Map<string, string[]>();
  const nameFolder = (name: string, folder: string) => {
    if (!folder) return;
    for (const key of [words(name).join('-'), meaningful(name).join('-')]) {
      if (!key) continue;
      const folders = folderNames.get(key) ?? [];
      if (!folders.includes(folder)) folders.push(folder);
      folderNames.set(key, folders);
    }
  };
  for (const page of indexed) {
    for (let depth = 1; depth < page.segments.length; depth++) {
      nameFolder(
        page.segments[depth - 1] ?? '',
        page.segments.slice(0, depth).join('/'),
      );
    }
  }
  const folderFronts = new Map<string, string>();
  const nameGroup = (group: NearMissNavGroup) => {
    const folder = groupFolder(group);
    for (const label of group.labels) nameFolder(label, folder);
    const front = frontPage(group);
    if (folder && front !== undefined && !folderFronts.has(folder)) {
      folderFronts.set(folder, front);
    }
    for (const entry of group.entries) {
      if (typeof entry !== 'string') nameGroup(entry);
    }
  };
  for (const group of groups) nameGroup(group);
  // Nearest first: a name both a folder and one of its subfolders answer to
  // means the folder.
  for (const folders of folderNames.values()) {
    folders.sort((a, b) => depthOf(a) - depthOf(b));
  }

  return {
    pages: indexed,
    byRoute,
    titleSlugs,
    titleKeys,
    sectionSlugs,
    sectionKeys,
    folderNames,
    folderFronts,
  };
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
  includeSectionContext = true,
): { score: number; leafCredit: number } {
  let leafCredit = 0;
  for (const word of parsed.leafWords) {
    leafCredit += wordCredit(word, page.tokens);
  }
  // A folder of the guess names the page itself or a section above it.
  let folderCredit = 0;
  for (const word of parsed.folderWords) {
    folderCredit += Math.max(
      wordCredit(word, page.tokens),
      includeSectionContext ? wordCredit(word, page.context) : 0,
    );
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

/**
 * Of pages that all end in the guessed leaf, the one whose title the leaf
 * names: `skills` is half of `Skill library` and a third of `Equip agents
 * with skills`. Null when no title carries the leaf, or two carry it alike.
 */
function namedByLeaf(
  parsed: ParsedQuery,
  pages: readonly IndexedPage[],
): string | null {
  if (pages.length === 1) return pages[0]?.route ?? null;
  let best: { route: string; share: number } | null = null;
  let tied = false;
  for (const page of pages) {
    let share = 0;
    for (const title of page.titleWords) {
      if (title.length === 0) continue;
      const named = title.filter((word) => parsed.leafWords.includes(word));
      share = Math.max(share, named.length / title.length);
    }
    if (best === null || share > best.share) {
      best = { route: page.route, share };
      tied = false;
    } else if (share === best.share) {
      tied = true;
    }
  }
  return best !== null && best.share > 0 && !tied ? best.route : null;
}

/**
 * The single best of `pages` by folder overlap, the title deciding between
 * pages that share as many folders; null on a tie.
 */
function bestByFolders(
  parsed: ParsedQuery,
  pages: readonly IndexedPage[],
): string | null {
  const overlaps = pages.map((page) => folderOverlap(parsed, page));
  const most = Math.max(...overlaps);
  return namedByLeaf(
    parsed,
    pages.filter((_, i) => overlaps[i] === most),
  );
}

/** A section's front page: the page at `route`, else the first under it. */
function sectionPage(route: string, index: NearMissIndex): string | null {
  if (index.byRoute.has(route)) return route;
  const prefix = route ? `${route}/` : '';
  return (
    index.pages.find((page) => page.route.startsWith(prefix))?.route ?? null
  );
}

/**
 * Where a folder opens: the front page of the sidebar group that holds it
 * (`platform/admin/overview`), else its own page or the first one under it.
 */
function folderFront(folder: string, index: NearMissIndex): string | null {
  return index.folderFronts.get(folder) ?? sectionPage(folder, index);
}

/** The folders under `parent` a guessed segment names, nearest first. */
function foldersNamed(
  segment: string,
  parent: string,
  index: NearMissIndex,
): string[] {
  const prefix = parent ? `${parent}/` : '';
  const found: string[] = [];
  for (const key of [segment, meaningful(segment).join('-')]) {
    for (const folder of index.folderNames.get(key) ?? []) {
      if (folder.startsWith(prefix) && !found.includes(folder)) {
        found.push(folder);
      }
    }
  }
  return found.sort((a, b) => depthOf(a) - depthOf(b));
}

/** A guess read in the site's own folders. */
interface Placement {
  /** The guess spelled in them: a page, a folder, or one a redirect knows. */
  route: string;
  /** The folders it reached, nearest first; their pages are searched first. */
  folders: readonly string[];
}

/**
 * A guess read in the site's folders: each folder of the guess placed on the
 * one it names under the folder before it (`plattform/wissen` →
 * `platform/knowledge`), one that names none passed over, and the leaf read
 * as a page or a folder there (`plattform/agents` → `platform/agents`).
 * Null when no folder of the guess names one: a leaf alone keeps the
 * existing order, a page title ahead of a section label.
 */
function place(parsed: ParsedQuery, index: NearMissIndex): Placement | null {
  let parents: readonly string[] = [''];
  for (const segment of parsed.segments.slice(0, -1)) {
    const named = [
      ...new Set(
        parents.flatMap((parent) => foldersNamed(segment, parent, index)),
      ),
    ];
    if (named.length > 0) parents = named;
  }
  const [nearest = ''] = parents;
  if (nearest === '') return null;
  const leaf = parsed.segments.at(-1) ?? '';
  for (const parent of parents) {
    const route = `${parent}/${leaf}`;
    if (index.byRoute.has(route)) return { route, folders: [parent] };
  }
  for (const parent of parents) {
    const [folder] = foldersNamed(leaf, parent, index);
    if (folder !== undefined) return { route: folder, folders: [folder] };
  }
  return { route: `${nearest}/${leaf}`, folders: parents };
}

/** The routes in `routes` that `within` admits. */
function inside(
  routes: ReadonlySet<string> | undefined,
  within: (route: string) => boolean,
): ReadonlySet<string> {
  return new Set([...(routes ?? [])].filter(within));
}

/**
 * The page a guess means among the pages under the folders it was placed
 * in, or null: a generic leaf is the section itself, then the page's own
 * last segment, a title and the fuzzy score, as across the whole site.
 */
function resolveWithin(
  parsed: ParsedQuery,
  index: NearMissIndex,
  folders: readonly string[],
): string | null {
  const within = (route: string) =>
    folders.some(
      (folder) => route === folder || route.startsWith(`${folder}/`),
    );
  const leaf = parsed.segments.at(-1) ?? '';
  if (GENERIC_LEAVES.has(leaf)) return folderFront(folders[0] ?? '', index);
  const sameLeaf = index.pages.filter(
    (page) => page.leaf === leaf && within(page.route),
  );
  if (sameLeaf.length > 0) {
    const picked = namedByLeaf(parsed, sameLeaf);
    if (picked !== null) return picked;
  }
  const byTitle =
    only(inside(index.titleSlugs.get(leaf), within)) ??
    only(inside(index.titleKeys.get(parsed.leafWords.join('-')), within));
  if (byTitle !== null) return byTitle;
  if (parsed.leafWords.length === 0) return null;
  // The folders are spent on getting here, and every page here matches them
  // alike: only the leaf tells these pages apart.
  return scoredPage({ ...parsed, folderWords: [] }, index, false, within);
}

/**
 * The front page of the section a guess names by its sidebar label
 * (`verwaltung`, `plattform/automatisierungen`), or null. Two sections can
 * carry one label — the platform's administration and the tutorials' group
 * of the same name: the folders of the guess pick between them, and with
 * none to go by the first in reading order wins, the one a reader meets
 * first.
 */
function labelledSection(
  parsed: ParsedQuery,
  index: NearMissIndex,
): string | null {
  const sections =
    index.sectionSlugs.get(parsed.segments.at(-1) ?? '') ??
    index.sectionKeys.get(parsed.leafWords.join('-'));
  let best: IndexedSection | undefined;
  let bestOverlap = -1;
  for (const section of sections ?? []) {
    const overlap = parsed.folderWords.filter(
      (word) => wordCredit(word, section.context) > 0,
    ).length;
    if (overlap > bestOverlap) {
      best = section;
      bestOverlap = overlap;
    }
  }
  // A label alone may use reading order. A qualified guess must actually
  // name this section's context; `self-hosted/genehmigungen` must not be
  // captured by the platform's Approvals group.
  if (parsed.folderWords.length > 0 && bestOverlap <= 0) return null;
  return best?.route ?? null;
}

/** Minimum fuzzy score a guess needs, and its lead over the runner-up. */
const MIN_SCORE = 0.6;
const MIN_MARGIN = 0.15;

/**
 * A fuzzy winner among the pages `within` admits, with the same confidence
 * floor with or without labels.
 */
function scoredPage(
  parsed: ParsedQuery,
  index: NearMissIndex,
  includeSectionContext: boolean,
  within: (route: string) => boolean = () => true,
): string | null {
  let best: { route: string; score: number } | null = null;
  let runnerUp = 0;
  for (const page of index.pages) {
    if (!within(page.route)) continue;
    const { score, leafCredit } = scorePage(
      parsed,
      page,
      includeSectionContext,
    );
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

  // The folders the guess names, translated or moved (`plattform/wissen/…`):
  // the page or section it spells there answers outright.
  const placed = place(parsed, index);
  if (placed !== null) {
    if (index.byRoute.has(placed.route)) return placed.route;
    const front = folderFront(placed.route, index);
    if (front !== null) return front;
  }
  const anywhere = resolveAnywhere(parsed, index);
  if (placed === null) return anywhere;
  // A page in those folders beats one elsewhere, which stays the answer
  // only when they hold none: `plattform/verwaltung/anbieter` means the
  // admin section's AI providers, not the self-hosted page titled Anbieter,
  // while `plattform/installation/kubernetes` still finds its page.
  const inPlace = (found: string) =>
    placed.folders.some(
      (folder) => found === folder || found.startsWith(`${folder}/`),
    );
  if (anywhere !== null && inPlace(anywhere)) return anywhere;
  return resolveWithin(parsed, index, placed.folders) ?? anywhere;
}

/** The page a guess means across the whole site, or null. */
function resolveAnywhere(
  parsed: ParsedQuery,
  index: NearMissIndex,
): string | null {
  const leaf = parsed.segments.at(-1) ?? '';

  // `/platform/overview`, `/self-hosted/install/introduction`: the section,
  // by its folder or by its label (`/verwaltung/overview`).
  if (GENERIC_LEAVES.has(leaf) && parsed.segments.length > 1) {
    const folder = parsed.segments.slice(0, -1).join('/');
    const named = parseQuery(folder);
    const section =
      sectionPage(folder, index) ??
      (named === null ? null : labelledSection(named, index));
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

  // A section's sidebar label, in any language the site ships.
  const section = labelledSection(parsed, index);
  if (section !== null) return section;

  if (parsed.leafWords.length === 0) return null;
  // Group labels add context, but can also boost several unrelated pages
  // until a previously clear title/route match loses its margin. Keep that
  // original evidence as a fallback, with the same confidence requirements.
  return (
    scoredPage(parsed, index, true) ??
    (parsed.folderWords.length > 0 ? scoredPage(parsed, index, false) : null)
  );
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
  /**
   * Answer a guess no page clearly wins with the page the section its
   * folders name opens on (`/de/verwaltung/xyz` → the admin overview)
   * instead of the 404. For a site whose sections mostly open on an
   * overview; a site of independent guides keeps the 404, so a missing
   * `components/select` never lands on the button guide.
   */
  closestSection?: boolean;
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
 * is a 302, and so, where the site asks for it (`closestSection`), is a
 * guess whose folders name a section but no page in it, to that section's
 * first page; anything else is null and the site answers its 404.
 * Asset-like paths are never guessed at — a stale script chunk must stay a
 * 404.
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

  // Read in the site's folders, the guess may name a moved page
  // (`plattform/automatisierungen/workflows`): its redirect answers.
  const parsed = parseQuery(route);
  const placed = parsed === null ? null : place(parsed, site.index);
  if (placed !== null && placed.route !== route) {
    const movedThere = site.redirectFor(site.pagePath(locale, placed.route));
    if (movedThere !== undefined) return answer(withExport(movedThere), false);
  }

  // No page clearly wins: the section the guess's folders name lists what
  // there is, which serves a reader, or a model, better than a 404.
  const [section] = placed?.folders ?? [];
  const guess =
    resolveNearMiss(route, site.index) ??
    (site.closestSection && section !== undefined
      ? folderFront(section, site.index)
      : null);
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
