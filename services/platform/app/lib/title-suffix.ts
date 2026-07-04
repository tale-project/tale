const STORAGE_KEY = 'tale:title-suffix';

const isBrowser = typeof window !== 'undefined';

/**
 * Last-known organization name used as the document-title suffix
 * (`"<page> - <org>"`), cached so a hard reload can render the correct suffix
 * on first paint instead of flashing the "Tale" fallback while branding loads.
 *
 * The route `head`/`seo()` reads this synchronously at head time;
 * `BrandingProvider` writes it once the org's branding resolves, and the
 * sign-out flow clears it so the logged-out shell falls back to "Tale".
 *
 * Deliberately a single value (not keyed per org): the common reload stays in
 * the same org, so the last-known name is the right guess, and a rare
 * cross-org deep link converges to the correct suffix as soon as that org's
 * branding loads.
 */
function readStored(): string | undefined {
  if (!isBrowser) return undefined;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch (error) {
    console.warn('Failed to read cached title suffix:', error);
    return undefined;
  }
}

let cachedSuffix: string | undefined = readStored();

/** The cached org-name suffix, or `undefined` when none is known. */
export function getTitleSuffix(): string | undefined {
  return cachedSuffix;
}

/**
 * Cache the org name used as the title suffix (or clear it with `undefined`).
 * Returns `true` when the value actually changed, so the caller can refresh an
 * already-rendered title (the head for the current match ran with the previous
 * suffix — e.g. the "Tale" fallback on a first-ever login).
 */
export function setTitleSuffix(name: string | undefined): boolean {
  const next = name && name.length > 0 ? name : undefined;
  if (next === cachedSuffix) return false;
  cachedSuffix = next;
  if (isBrowser) {
    try {
      if (next === undefined) {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch (error) {
      // Quota / security errors — the in-memory value still applies this
      // session; only the cross-reload persistence is lost.
      console.warn('Failed to persist cached title suffix:', error);
    }
  }
  return true;
}

/** Forget the cached org name so the title falls back to "Tale" (sign-out). */
export function clearTitleSuffix(): void {
  setTitleSuffix(undefined);
}
