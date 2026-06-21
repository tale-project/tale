/**
 * The upstream issue number from a task's external ref ("owner/repo#N"), for
 * human/commit references (`input.issueNumber`). Returns null for a missing ref
 * or a non-numeric tail — callers pass null through to the workflow, which only
 * string-interpolates the value. NOTE: `task.number` is an internal per-project
 * counter, NOT the issue id; this derives the real one from the external ref.
 */
export function parseIssueNumber(
  externalId: string | undefined,
): number | null {
  const parsed = Number(externalId?.split('#').pop());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The `owner` / `repo` from a task's external ref ("owner/repo#N", e.g.
 * "tale-project/tale#1851"). Used to address the upstream repository for
 * actions like merging the task's pull request. Returns null for a missing or
 * malformed ref (no single owner/repo split, or a repo segment that itself
 * contains a slash) — callers must treat that as "not a GitHub-repo task".
 */
export function parseRepoRef(
  externalId: string | undefined,
): { owner: string; repo: string } | null {
  if (!externalId) return null;
  const repoPart = externalId.split('#')[0];
  const slash = repoPart.indexOf('/');
  if (slash <= 0 || slash >= repoPart.length - 1) return null;
  const owner = repoPart.slice(0, slash);
  const repo = repoPart.slice(slash + 1);
  if (owner === '' || repo === '' || repo.includes('/')) return null;
  return { owner, repo };
}
