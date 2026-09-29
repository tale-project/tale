/**
 * The last project detail page visited from Home — read by
 * `useNavigationItems` to send the Home rail tile straight back to it (only
 * when Home isn't already active, so Chat/Tasks/Inbox's own behavior is
 * untouched), written by `projects/$projectId.tsx` as the tab/project
 * changes. Covers every project sub-route, including a bound automation's
 * workbench under `.../automations/$automationSlug`.
 */

function storageKey(organizationId: string): string {
  return `tale.platform.home.${organizationId}.lastProjectPath`;
}

export function readProjectMemory(organizationId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const key = storageKey(organizationId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    const root = `/dashboard/${organizationId}/projects/`;
    // Defends against a value a past bug could have written under this key
    // that doesn't actually point at a project (self-heals by clearing it,
    // so a future read isn't stuck re-validating the same bad value).
    if (typeof parsed !== 'string' || !parsed.startsWith(root)) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.warn('[home] failed to read remembered project path', error);
    return undefined;
  }
}

export function persistProjectMemory(
  organizationId: string,
  pathname: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      storageKey(organizationId),
      JSON.stringify(pathname),
    );
  } catch (error) {
    console.warn('[home] failed to persist remembered project path', error);
  }
}

export function clearProjectMemory(organizationId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(organizationId));
  } catch (error) {
    console.warn('[home] failed to clear remembered project path', error);
  }
}
