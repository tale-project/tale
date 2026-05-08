import type { RecentSearch } from './types';

const STORAGE_KEY = 'tale.docs.recentSearches.v1';
const MAX_RECENT = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRecent(value: unknown): value is RecentSearch {
  if (!isRecord(value)) return false;
  if (typeof value.query !== 'string' || value.query.length === 0) return false;
  if (typeof value.savedAt !== 'number') return false;
  if (value.url !== undefined && typeof value.url !== 'string') return false;
  if (value.title !== undefined && typeof value.title !== 'string')
    return false;
  return true;
}

export function loadRecentSearches(): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
  entry: Pick<RecentSearch, 'query' | 'url' | 'title'>,
): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  const trimmed = entry.query.trim();
  if (!trimmed) return loadRecentSearches();

  const existing = loadRecentSearches();
  const next: RecentSearch[] = [
    { ...entry, query: trimmed, savedAt: Date.now() },
    ...existing.filter(
      (item) => item.query.toLowerCase() !== trimmed.toLowerCase(),
    ),
  ].slice(0, MAX_RECENT);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('[search] failed to persist recent searches', error);
  }
  return next;
}

export function removeRecentSearch(query: string): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  const trimmed = query.trim().toLowerCase();
  const next = loadRecentSearches().filter(
    (item) => item.query.toLowerCase() !== trimmed,
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn('[search] failed to persist recent searches', error);
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('[search] failed to clear recent searches', error);
  }
}
