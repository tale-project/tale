import { automationSlugToParam } from '@/lib/automations/slug';

/** The detail tabs every automation carries — a sibling switch keeps the open one. */
const PORTABLE_AUTOMATION_SEGMENTS = new Set(['editor', 'versions', 'runs']);

/** Default landing when the current path is bare or automation-specific. */
const DEFAULT_AUTOMATION_SUFFIX = '/editor';

/**
 * The root pathname of one automation's detail pages — under its project
 * shell when a project is given, on the org area otherwise. The tabs hang off
 * it (`/editor`, `/versions`, `/runs`), as does a run's own page.
 */
export function automationDetailPathname({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string;
}): string {
  const slug = automationSlugToParam(automationSlug);
  return projectId !== undefined
    ? `/dashboard/${organizationId}/projects/${projectId}/automations/${slug}`
    : `/dashboard/${organizationId}/automations/${slug}`;
}

/**
 * Where a breadcrumb switch lands when jumping to a sibling automation: the
 * same tab on the sibling, the way the project switcher keeps a project's tab.
 * A run's own page is specific to this automation, so it resets to the
 * sibling's Runs list; a bare or unknown path lands on the Editor, the
 * automation's default surface. The editor's `?version=` never travels — a
 * version number means nothing on another automation.
 *
 * `@param pathname` the current location pathname
 * `@param fromRoot` the open automation's detail root (`automationDetailPathname`)
 * `@param toRoot` the sibling's detail root
 */
export function automationSwitchPathname(
  pathname: string,
  fromRoot: string,
  toRoot: string,
): string {
  if (pathname !== fromRoot && !pathname.startsWith(`${fromRoot}/`)) {
    return `${toRoot}${DEFAULT_AUTOMATION_SUFFIX}`;
  }
  const rest = pathname.slice(fromRoot.length);
  const firstSegment = rest.slice(1).split('/')[0] ?? '';
  if (!PORTABLE_AUTOMATION_SEGMENTS.has(firstSegment)) {
    return `${toRoot}${DEFAULT_AUTOMATION_SUFFIX}`;
  }
  return `${toRoot}/${firstSegment}`;
}
