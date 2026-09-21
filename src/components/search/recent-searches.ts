import type { RecentSearch } from './types';

const MAX_RECENT = 6;

/**
 * localStorage-backed recent searches. The storage key is a **parameter** so
 * each surface namespaces its own history (`tale.docs.…`,
 * `tale.platform.chat.…`) without colliding. All reads are defensive — a
 * malformed/foreign payload yields an empty list rather than throwing.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecent(value: unknown): value is RecentSearch {
  if (!isRecord(value)) return false;
  if (typeof value.query !== 'string' || value.query.length === 0) return false;
  if (typeof value.savedAt !== 'number') return false;
  if (value.href !== undefined && typeof value.href !== 'string') return false;
  if (value.title !== undefined && typeof value.title !== 'string')
    return false;
  return true;
}

export function loadRecentSearches(key: string): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).slice(0, MAX_RECENT);
  } catch (error) {
    console.warn('[search] failed to read recent searches', error);
    return [];
  }
}

export function saveRecentSearch(
  key: string,
  entry: Pick<RecentSearch, 'query' | 'href' | 'title'>,
): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  const trimmed = entry.query.trim();
  if (!trimmed) return loadRecentSearches(key);

  const existing = loadRecentSearches(key);
  const next: RecentSearch[] = [
    { ...entry, query: trimmed, savedAt: Date.now() },
    ...existing.filter(
      (item) => item.query.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, MAX_RECENT);

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch (error) {
    console.warn('[search] failed to persist recent searches', error);
  }
  return next;
}

export function removeRecentSearch(key: string, query: string): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  const trimmed = query.trim().toLowerCase();
  const next = loadRecentSearches(key).filter(
    (item) => item.query.toLowerCase() !== trimmed,
  );
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch (error) {
    console.warn('[search] failed to persist recent searches', error);
  }
  return next;
}

export function clearRecentSearches(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('[search] failed to clear recent searches', error);
  }
}
