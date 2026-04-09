/**
 * Checks whether all tools invoked in a response are cacheable,
 * based on the agent's noCacheToolNames configuration.
 *
 * If any called tool is listed in noCacheToolNames, the response
 * should not be cached.
 */
export function areAllToolsCacheable(
  calledToolNames: string[],
  noCacheToolNames: string[] | undefined,
): boolean {
  if (calledToolNames.length === 0) return true;
  if (!noCacheToolNames || noCacheToolNames.length === 0) return true;
  const noCacheSet = new Set(noCacheToolNames);
  return !calledToolNames.some((name) => noCacheSet.has(name));
}
