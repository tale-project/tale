const PERSONAL_SETTINGS_SEGMENTS = new Set([
  'personal',
  'account',
  'personalization',
]);

/**
 * True when `pathname` points at one of the per-user settings sections
 * (personal / account / personalization) under the given organization's
 * settings route, rather than an organization-level settings page.
 */
export function isPersonalSettingsPath(
  pathname: string,
  organizationId: string,
): boolean {
  const base = `/dashboard/${organizationId}/settings/`;
  if (!pathname.startsWith(base)) return false;
  const next = pathname.slice(base.length).split('/')[0];
  return PERSONAL_SETTINGS_SEGMENTS.has(next);
}
