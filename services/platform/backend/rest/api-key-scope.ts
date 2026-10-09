import { isModelApiDoorPath } from '../domains/model_api/wire.ts';

/**
 * Where a project's own API key may go on `/api/v1`: its own project and
 * everything under it, the project list (which shows that one project), the
 * key's own `/me`, and the model endpoints (its calls count toward the
 * project). Everything else — organization-wide resources, other projects,
 * the MCP endpoint — is refused before a handler runs, so no organization
 * route can answer such a key from a member's audience.
 *
 * `path` is the request path as the door sees it (`/api/v1/projects/…`).
 */
export function projectKeyReaches(
  method: string,
  path: string,
  projectId: string,
): boolean {
  if (isModelApiDoorPath(path)) return true;
  const relative = path.startsWith('/api/v1/')
    ? path.slice('/api/v1'.length)
    : path;
  if (relative === '/me') return true;
  if (relative === '/projects' || relative === '/projects/') {
    return method === 'GET' || method === 'HEAD';
  }
  const match = /^\/projects\/([^/]+)(?:\/|$)/.exec(relative);
  if (match === null) return false;
  let segment: string;
  try {
    segment = decodeURIComponent(match[1] ?? '');
  } catch (error) {
    // A malformed escape names no project at all.
    console.warn(
      '[rest] project key path has a malformed escape:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
  return segment === projectId;
}
