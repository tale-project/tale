/**
 * Where an agent breadcrumb switch should land when jumping between agents.
 *
 * Editor tabs exist on every agent and are preserved. Anything else under the
 * agent id (future nested routes) resets to the agent overview.
 */

const PORTABLE_AGENT_SEGMENTS = new Set([
  'instructions',
  'tools',
  'skills',
  'knowledge',
]);

/**
 * `@param pathname` the current location pathname
 * `@param organizationId` active org id
 * `@param fromAgentId` agent currently open (decoded route param)
 * `@param toAgentId` agent to open (decoded slug / name)
 */
export function agentSwitchPathname(
  pathname: string,
  organizationId: string,
  fromAgentId: string,
  toAgentId: string,
): string {
  const fromEnc = encodeURIComponent(fromAgentId);
  const toEnc = encodeURIComponent(toAgentId);
  const prefix = `/dashboard/${organizationId}/agents/${fromEnc}`;
  const targetRoot = `/dashboard/${organizationId}/agents/${toEnc}`;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    // Path may carry a raw (decoded) agent id when the slug has no reserved
    // characters — accept that form too so the switch still preserves tabs.
    const rawPrefix = `/dashboard/${organizationId}/agents/${fromAgentId}`;
    if (pathname === rawPrefix || pathname.startsWith(`${rawPrefix}/`)) {
      return switchRest(pathname, rawPrefix, targetRoot);
    }
    return targetRoot;
  }
  return switchRest(pathname, prefix, targetRoot);
}

function switchRest(
  pathname: string,
  prefix: string,
  targetRoot: string,
): string {
  const rest = pathname.slice(prefix.length);
  if (rest === '' || rest === '/') return targetRoot;
  const firstSegment = rest.slice(1).split('/')[0] ?? '';
  if (!PORTABLE_AGENT_SEGMENTS.has(firstSegment)) return targetRoot;
  return `${targetRoot}${rest}`;
}
