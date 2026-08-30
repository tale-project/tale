// Resolving which compose containers a restart targets, across deploy
// topologies. The CLI deploys rotatable services blue/green — at runtime
// `platform` is compose service `platform-<color>` under project
// `<project>-<color>` (container `tale-platform-blue`) — while the hand-written
// compose runs them as plain `platform` under `<project>`. Matching both shapes
// keeps "Apply & restart" working on every deployment. Stateful services
// (the backend) are never colored. The controller's allowlist currently scopes
// restarts to the backend + sandbox, so no colored candidate is produced
// today; the set
// stays here so re-adding a rotatable target needs no machinery change.

const ROTATABLE = new Set<string>();
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
