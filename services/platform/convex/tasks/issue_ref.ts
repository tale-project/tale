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
