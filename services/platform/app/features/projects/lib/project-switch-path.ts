/**
 * Where a project breadcrumb switch should land when jumping between projects.
 *
 * Core collaboration / management tabs exist on every project and are preserved
 * (including task sub-views like `/tasks/board` and General at `/overview`).
 * Bound-view and nested automation detail paths are project-specific — those
 * reset to Tasks (the project's default surface) so the operator never
 * dead-ends on a missing view or automation.
 */

const PORTABLE_PROJECT_SEGMENTS = new Set([
  'overview',
  'threads',
  'tasks',
  'metrics',
  'instructions',
  'files',
  'agents',
  'secrets',
  'settings',
]);

/** Default landing when the current path is bare or not portable. */
const DEFAULT_PROJECT_SUFFIX = '/tasks';

/**
 * `@param pathname` the current location pathname
 * `@param organizationId` active org id
 * `@param fromProjectId` project currently open
 * `@param toProjectId` project to open
 */
export function projectSwitchPathname(
  pathname: string,
  organizationId: string,
  fromProjectId: string,
  toProjectId: string,
): string {
  const prefix = `/dashboard/${organizationId}/projects/${fromProjectId}`;
  const targetRoot = `/dashboard/${organizationId}/projects/${toProjectId}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    return `${targetRoot}${DEFAULT_PROJECT_SUFFIX}`;
  }
  const rest = pathname.slice(prefix.length);
  if (rest === '' || rest === '/') {
    return `${targetRoot}${DEFAULT_PROJECT_SUFFIX}`;
  }
  const firstSegment = rest.slice(1).split('/')[0] ?? '';
  if (!PORTABLE_PROJECT_SEGMENTS.has(firstSegment)) {
    return `${targetRoot}${DEFAULT_PROJECT_SUFFIX}`;
  }
  return `${targetRoot}${rest}`;
}
