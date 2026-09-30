/**
 * The last org-scoped automation detail page visited — read by
 * `useNavigationItems` to send the Automations rail tile straight back to it,
 * written by `AutomationDetailShell` as the tab/automation changes. Org-scoped
 * only: a project-scoped automation route belongs to the project it's bound
 * to (see `features/home/lib/project-memory.ts`), not to this section.
 */

function storageKey(organizationId: string): string {
  return `tale.platform.automations.${organizationId}.lastPath`;
}

export function readAutomationMemory(
  organizationId: string,
): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const key = storageKey(organizationId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    const root = `/dashboard/${organizationId}/automations/`;
    // Defends against a value a past bug could have written under this key
    // that doesn't actually point at an automation (self-heals by clearing
    // it, so a future read isn't stuck re-validating the same bad value).
    if (typeof parsed !== 'string' || !parsed.startsWith(root)) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch (error) {
    console.warn('[automations] failed to read remembered path', error);
    return undefined;
  }
}

export function persistAutomationMemory(
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
    console.warn('[automations] failed to persist remembered path', error);
  }
}

export function clearAutomationMemory(organizationId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(organizationId));
  } catch (error) {
    console.warn('[automations] failed to clear remembered path', error);
  }
}
