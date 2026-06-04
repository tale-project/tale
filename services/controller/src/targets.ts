// Resolving which compose containers a restart targets, across deploy
// topologies. The CLI deploys rotatable services blue/green — at runtime `rag`
// is compose service `rag-<color>` under project `<project>-<color>` (container
// `tale-rag-blue`) — while the hand-written compose runs them as plain `rag`
// under `<project>`. Matching both shapes keeps "Apply & restart" working on
// every deployment. Stateful services (`convex`) are never colored.

export const ROTATABLE = new Set(['rag']);
const COLORS = ['blue', 'green'] as const;

/** Candidate compose service labels for a service across blue/green topologies. */
export function serviceCandidates(svc: string): string[] {
  return ROTATABLE.has(svc)
    ? [svc, ...COLORS.map((c) => `${svc}-${c}`)]
    : [svc];
}

/**
 * Candidate compose projects to scope a lookup to. `undefined` means "any
 * project" and is only used when the controller doesn't know its own project.
 * Exact membership (never a prefix) keeps a sibling stack on the host untouched.
 */
export function projectCandidates(
  project: string | undefined,
  svc: string,
): string[] | undefined {
  if (!project) return undefined;
  return ROTATABLE.has(svc)
    ? [project, ...COLORS.map((c) => `${project}-${c}`)]
    : [project];
}
