import { automationSlugToParam } from '@/lib/automations/slug';

/** The detail tabs every automation carries — a sibling switch keeps the open one. */
const PORTABLE_AUTOMATION_SEGMENTS = new Set([
  'editor',
  'general',
  'versions',
  'runs',
]);

/** Default landing when the current path is bare or automation-specific. */
const DEFAULT_AUTOMATION_SUFFIX = '/editor';

/**
 * The root pathname of one automation's detail pages — under its project
 * shell when a project is given, on the org area otherwise. The tabs hang off
 * it (`/editor`, `/general`, `/versions`, `/runs`), as does a run's own page.
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

/**
 * The editor at one version of an automation, under its project shell when a
 * project is given — what a version's "Open in editor" follows.
 */
export function editorVersionLink({
  organizationId,
  automationSlug,
  projectId,
  version,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  version: number;
}) {
  const slug = automationSlugToParam(automationSlug);
  return projectId !== undefined
    ? {
        to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor' as const,
        params: { id: organizationId, projectId, automationSlug: slug },
        search: { version },
      }
    : {
        to: '/dashboard/$id/automations/$automationSlug/editor' as const,
        params: { id: organizationId, automationSlug: slug },
        search: { version },
      };
}

/**
 * The comparison of one version of an automation with another — the version
 * before it when `from` is left out — under its project shell when a project
 * is given.
 */
export function compareVersionLink({
  organizationId,
  automationSlug,
  projectId,
  version,
  from,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  version: number;
  from?: number | undefined;
}) {
  const slug = automationSlugToParam(automationSlug);
  const search = from === undefined ? {} : { from };
  return projectId !== undefined
    ? {
        to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/versions/$version' as const,
        params: {
          id: organizationId,
          projectId,
          automationSlug: slug,
          version: String(version),
        },
        search,
      }
    : {
        to: '/dashboard/$id/automations/$automationSlug/versions/$version' as const,
        params: {
          id: organizationId,
          automationSlug: slug,
          version: String(version),
        },
        search,
      };
}

/** An automation's Versions tab — its deployments with `tab` — under its
 * project shell when a project is given. */
export function versionsTabLink({
  organizationId,
  automationSlug,
  projectId,
  tab,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  tab?: 'deployments';
}) {
  const slug = automationSlugToParam(automationSlug);
  const search = tab === undefined ? {} : { tab };
  return projectId !== undefined
    ? {
        to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/versions' as const,
        params: { id: organizationId, projectId, automationSlug: slug },
        search,
      }
    : {
        to: '/dashboard/$id/automations/$automationSlug/versions' as const,
        params: { id: organizationId, automationSlug: slug },
        search,
      };
}
