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
 * intent. Restoring them would re-trigger the flow, so they are stripped from
 * the recorded subpath while the rest of the query survives.
 */
const ONE_SHOT_PARAMS = [
  'cloudImport',
  'cloudImportStatus',
  'compose',
  'composeContact',
  'new',
] as const;

interface NavMemoryRecord {
  sections: Partial<Record<NavSection, string>>;
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
    const clean: Partial<Record<NavSection, string>> = {};
    for (const [key, value] of Object.entries(sections)) {
      if (SECTION_SET.has(key) && typeof value === 'string' && value !== '') {
        clean[key as NavSection] = value;
      }
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

/** The section a dashboard-relative subpath belongs to, or `undefined` for a
 *  path that is not inside one (the org home, the switching staging route). */
export function sectionForSubpath(subpath: string): NavSection | undefined {
  const segment = subpath.split(/[/?#]/, 1)[0];
  if (segment === undefined || segment === '') return undefined;
  return SECTION_BY_SEGMENT[segment];
}

/**
 * A public read-only chat snapshot is not a place inside the section — it is
 * reachable without being a member, and restoring into it would strand the
 * user outside their own chat list.
 */
function isNeverRecorded(subpath: string): boolean {
  return subpath === 'chat/shared' || subpath.startsWith('chat/shared/');
}

/** Drops {@link ONE_SHOT_PARAMS}, leaving the subpath byte-identical when none
 *  are present (the common case) so a restore reproduces the URL exactly. */
export function stripOneShotParams(subpath: string): string {
  const queryAt = subpath.indexOf('?');
  if (queryAt === -1) return subpath;
  const path = subpath.slice(0, queryAt);
  const query = subpath.slice(queryAt + 1);
  const params = new URLSearchParams(query);
  if (!ONE_SHOT_PARAMS.some((name) => params.has(name))) return subpath;
  for (const name of ONE_SHOT_PARAMS) params.delete(name);
  const rest = params.toString();
  return rest === '' ? path : `${path}?${rest}`;
}

/**
 * The remembered subpath for a section: this tab's first, then the shared copy
 * if it is still inside the TTL. `undefined` means "use the section's own
 * default entry".
 */
export function readNavTarget(
  organizationId: string,
  section: NavSection,
): string | undefined {
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
  subpath: string,
): void {
  if (!isBrowser) return;
  const section = sectionForSubpath(subpath);
  if (section === undefined || isNeverRecorded(subpath)) return;
  const target = stripOneShotParams(subpath);
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
 * Splits a router pathname into the org id and the dashboard-relative subpath.
 * `pathname` is basepath-relative (the router strips `basepath` when parsing),
 * which is why every caller in the app compares it against a bare
 * `/dashboard/...` string.
 */
export function parseDashboardPath(
  pathname: string,
  searchStr = '',
): { organizationId: string; subpath: string } | undefined {
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (segments[0] !== 'dashboard') return undefined;
  const organizationId = segments[1];
  if (organizationId === undefined || organizationId === '') return undefined;
  const rest = segments.slice(2).join('/');
  if (rest === '') return undefined;
  return { organizationId, subpath: `${rest}${searchStr}` };
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
      toLocation: { pathname: string; searchStr: string };
    }) => void,
  ) => () => void;
}): () => void {
  return router.subscribe('onResolved', ({ toLocation }) => {
    const parsed = parseDashboardPath(
      toLocation.pathname,
      toLocation.searchStr,
    );
    if (parsed === undefined) return;
    recordNavLocation(parsed.organizationId, parsed.subpath);
  });
}
