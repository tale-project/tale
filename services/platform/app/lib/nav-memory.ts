import { isRecord } from '@/lib/utils/type-utils';

/**
 * Per-section navigation memory: where the user last was inside each primary
 * rail section, so re-entering a section returns them there instead of its
 * root.
 *
 * The rail RESOLVES this; section roots never redirect. `/projects` keeps
 * rendering the projects list, so a shared link still means what it says and
 * the "Projects" breadcrumb still escapes the section (navigating to a root
 * records that root, which is what makes the breadcrumb a reset). Chat is the
 * one section whose root already redirects — that redirect is left alone and
 * serves as this module's fallback when there is no memory.
 *
 * Two stores, one shape:
 * - `sessionStorage` is this TAB's memory and wins every read, so two tabs on
 *   different projects never restore each other's.
 * - `localStorage` is the cross-tab / cross-restart seed and carries the TTL,
 *   so a fresh tab inherits where you were within the last {@link TTL_MS}.
 *
 * The org id is in the KEY, so a record for another org is structurally
 * unreachable rather than filtered out on read. Nothing clears these on org
 * switch — switching away and back is meant to find the memory intact.
 */

const STORAGE_PREFIX = 'tale:nav-memory:v1:';

/** Sliding: every recorded navigation refreshes `savedAt`, so the window only
 *  runs down while the user is away. Long enough to span a working day, short
 *  enough that tomorrow starts on each section's own landing page. */
const TTL_MS = 8 * 60 * 60 * 1000;

const isBrowser = typeof window !== 'undefined';

export const NAV_SECTIONS = [
  'chat',
  'projects',
  'knowledge',
  'automations',
  'conversations',
  'settings',
] as const;

export type NavSection = (typeof NAV_SECTIONS)[number];

/**
 * First path segment → section. Knowledge is the many-to-one case: five
 * sibling tabs (`_knowledge`, a pathless layout) share one rail entry, so the
 * section cannot be derived from the rail's href.
 */
const SECTION_BY_SEGMENT: Readonly<Record<string, NavSection>> = {
  chat: 'chat',
  projects: 'projects',
  documents: 'knowledge',
  'knowledge-entries': 'knowledge',
  websites: 'knowledge',
  products: 'knowledge',
  contacts: 'knowledge',
  automations: 'automations',
  conversations: 'conversations',
  settings: 'settings',
};

/**
 * Search params that describe a one-shot flow rather than a place: OAuth
 * import returns (already scrubbed with `replace` once consumed) and a compose
 * intent. Restoring them would re-trigger the flow, so they are dropped while
 * the rest of the search survives.
 */
const ONE_SHOT_PARAMS = [
  'cloudImport',
  'cloudImportStatus',
  'compose',
  'composeContact',
  'new',
] as const;

/**
 * A remembered place. The search object is kept SEPARATE from the path
 * because the router does not parse a query string out of a `to` prop — a
 * `to` of `"…/board?task=A"` becomes a pathname containing a literal `?`,
 * which then matches no route. `Link` takes the two as separate props, and
 * the router hands us `toLocation.search` already parsed, so storing the
 * object round-trips exactly (its parser is JSON-based: `?new=1` is the
 * NUMBER 1, not the string).
 */
export interface NavTarget {
  /** Dashboard-relative, no leading slash: `projects/p1/tasks/board`. */
  path: string;
  /** Omitted entirely when there is nothing to restore. */
  search?: Record<string, unknown>;
}

interface NavMemoryRecord {
  sections: Partial<Record<NavSection, NavTarget>>;
  savedAt: number;
}

function storageKey(organizationId: string): string {
  return `${STORAGE_PREFIX}${organizationId}`;
}

const SECTION_SET: ReadonlySet<string> = new Set(NAV_SECTIONS);

function parseRecord(raw: string): NavMemoryRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { sections, savedAt } = parsed;
    if (typeof savedAt !== 'number' || !isRecord(sections)) return null;
    const clean: Partial<Record<NavSection, NavTarget>> = {};
    for (const [key, value] of Object.entries(sections)) {
      if (!SECTION_SET.has(key) || !isRecord(value)) continue;
      const { path, search } = value;
      if (typeof path !== 'string' || path === '') continue;
      clean[key as NavSection] = {
        path,
        ...(isRecord(search) ? { search } : {}),
      };
    }
    return { sections: clean, savedAt };
  } catch (error) {
    console.warn('[nav-memory] failed to parse record', error);
    return null;
  }
}

function read(store: Storage, organizationId: string): NavMemoryRecord | null {
  let raw: string | null = null;
  try {
    raw = store.getItem(storageKey(organizationId));
  } catch (error) {
    console.warn('[nav-memory] failed to read', error);
    return null;
  }
  if (!raw) return null;
  return parseRecord(raw);
}

function write(
  store: Storage,
  organizationId: string,
  record: NavMemoryRecord,
): void {
  try {
    store.setItem(storageKey(organizationId), JSON.stringify(record));
  } catch (error) {
    // Quota or a privacy mode that refuses writes. The rail simply falls back
    // to each section's default entry.
    console.warn('[nav-memory] failed to write', error);
  }
}

/** The section a dashboard-relative path belongs to, or `undefined` for a
 *  path that is not inside one (the org home, the switching staging route). */
export function sectionForPath(path: string): NavSection | undefined {
  const segment = path.split('/', 1)[0];
  if (segment === undefined || segment === '') return undefined;
  return SECTION_BY_SEGMENT[segment];
}

/**
 * A public read-only chat snapshot is not a place inside the section — it is
 * reachable without being a member, and restoring into it would strand the
 * user outside their own chat list.
 */
function isNeverRecorded(path: string): boolean {
  return path === 'chat/shared' || path.startsWith('chat/shared/');
}

/** Drops {@link ONE_SHOT_PARAMS}, returning `undefined` when nothing is left
 *  so an empty search is never stored. */
export function stripOneShotParams(
  search: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (search === undefined) return undefined;
  const kept = Object.fromEntries(
    Object.entries(search).filter(
      ([key]) =>
        !ONE_SHOT_PARAMS.includes(key as (typeof ONE_SHOT_PARAMS)[number]),
    ),
  );
  return Object.keys(kept).length === 0 ? undefined : kept;
}

/**
 * The remembered place for a section: this tab's first, then the shared copy
 * if it is still inside the TTL. `undefined` means "use the section's own
 * default entry".
 */
export function readNavTarget(
  organizationId: string,
  section: NavSection,
): NavTarget | undefined {
  if (!isBrowser) return undefined;
  const tab = read(window.sessionStorage, organizationId);
  const fromTab = tab?.sections[section];
  if (fromTab !== undefined) return fromTab;
  const shared = read(window.localStorage, organizationId);
  if (!shared) return undefined;
  if (shared.savedAt + TTL_MS < Date.now()) {
    clearNavMemory(organizationId);
    return undefined;
  }
  return shared.sections[section];
}

/** Records a resolved dashboard location. No-ops for anything outside a
 *  section, and for the never-recorded paths above. */
export function recordNavLocation(
  organizationId: string,
  path: string,
  search?: Record<string, unknown>,
): void {
  if (!isBrowser) return;
  const section = sectionForPath(path);
  if (section === undefined || isNeverRecorded(path)) return;
  const kept = stripOneShotParams(search);
  const target: NavTarget = {
    path,
    ...(kept !== undefined ? { search: kept } : {}),
  };
  const savedAt = Date.now();
  for (const store of [window.sessionStorage, window.localStorage]) {
    const existing = read(store, organizationId);
    write(store, organizationId, {
      sections: { ...existing?.sections, [section]: target },
      savedAt,
    });
  }
}

/** Forgets one section, so its next rail click lands on the default entry.
 *  Used when a restored target turns out to be gone. */
export function clearNavSection(
  organizationId: string,
  section: NavSection,
): void {
  if (!isBrowser) return;
  for (const store of [window.sessionStorage, window.localStorage]) {
    const existing = read(store, organizationId);
    if (!existing) continue;
    const { [section]: _dropped, ...rest } = existing.sections;
    write(store, organizationId, { sections: rest, savedAt: existing.savedAt });
  }
}

/** Clears one org's memory, or every org's when called without an id (sign-out
 *  and stale-org recovery). */
export function clearNavMemory(organizationId?: string): void {
  if (!isBrowser) return;
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      if (organizationId !== undefined) {
        store.removeItem(storageKey(organizationId));
        continue;
      }
      for (const key of Object.keys(store)) {
        if (key.startsWith(STORAGE_PREFIX)) store.removeItem(key);
      }
    } catch (error) {
      console.warn('[nav-memory] failed to clear', error);
    }
  }
}

/**
 * Splits a router pathname into the org id and the dashboard-relative path.
 * `pathname` is basepath-relative (the router strips `basepath` when parsing),
 * which is why every caller in the app compares it against a bare
 * `/dashboard/...` string.
 */
export function parseDashboardPath(
  pathname: string,
): { organizationId: string; path: string } | undefined {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments[0] !== 'dashboard') return undefined;
  const organizationId = segments[1];
  if (organizationId === undefined || organizationId === '') return undefined;
  const rest = segments.slice(2).join('/');
  if (rest === '') return undefined;
  return { organizationId, path: rest };
}

/**
 * Records every resolved navigation. Installed once from `app/router.tsx`
 * beside `installOrgErrorRecovery` — a router subscription rather than an
 * effect in the dashboard layout, so this adds nothing to the React-Compiler
 * effect debt the repo contract tracks.
 */
export function installNavMemory(router: {
  subscribe: (
    event: 'onResolved',
    listener: (e: {
      toLocation: { pathname: string; search: Record<string, unknown> };
    }) => void,
  ) => () => void;
}): () => void {
  return router.subscribe('onResolved', ({ toLocation }) => {
    const parsed = parseDashboardPath(toLocation.pathname);
    if (parsed === undefined) return;
    recordNavLocation(parsed.organizationId, parsed.path, toLocation.search);
  });
}
