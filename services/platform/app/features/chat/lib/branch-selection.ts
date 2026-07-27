/**
 * Which sibling of each fork a conversation currently SHOWS.
 *
 * A lineage is a tree: the root the sidebar lists, and hidden branches forked
 * from it (or from each other) by edit/regenerate. The URL always names the
 * ROOT; the view walks the root's selection map — `"<parentId>:<forkSeq>" →
 * chosen thread` — to find the leaf actually rendered. Pure functions, so the
 * walk is unit-testable and tolerant by construction: a selection pointing at
 * a purged or foreign branch reads as absent and the view falls back to the
 * parent's own tail.
 */

export interface BranchInfo {
  readonly id: string;
  readonly parentId: string;
  readonly forkSequence: number;
  readonly createdAt: number;
}

export type BranchSelections = Readonly<Record<string, string>>;

/** Parse the root's stored selection JSON, dropping anything malformed. */
export function parseBranchSelections(
  json: string | null | undefined,
): BranchSelections {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch (error) {
    // A corrupt map means "no choices", never a broken conversation.
    console.warn('[chat] unreadable branch selections were ignored', error);
    return {};
  }
}

export function forkKey(parentId: string, forkSequence: number): string {
  return `${parentId}:${forkSequence}`;
}

/**
 * The chain of threads the view renders, root first, leaf last. From each
 * node, follow the selected sibling at the EARLIEST fork that selects away
 * from the node itself — a fork at sequence S replaces the node's tail from
 * S, so later forks of the same node are no longer part of the view.
 */
export function resolveViewPath(
  rootId: string,
  branches: readonly BranchInfo[],
  selections: BranchSelections,
): string[] {
  const path = [rootId];
  let current = rootId;
  // The guard bounds a hypothetical selection cycle; real trees are shallow.
  for (let guard = 0; guard < 50; guard += 1) {
    const forkSequences = [
      ...new Set(
        branches
          .filter((branch) => branch.parentId === current)
          .map((branch) => branch.forkSequence),
      ),
    ].sort((a, b) => a - b);

    let next: string | undefined;
    for (const sequence of forkSequences) {
      const chosen = selections[forkKey(current, sequence)];
      if (
        chosen !== undefined &&
        chosen !== current &&
        branches.some(
          (branch) =>
            branch.id === chosen &&
            branch.parentId === current &&
            branch.forkSequence === sequence,
        )
      ) {
        next = chosen;
        break;
      }
    }
    if (next === undefined) break;
    path.push(next);
    current = next;
  }
  return path;
}

export interface BranchForkGroup {
  readonly parentId: string;
  readonly forkSequence: number;
  /** The sibling thread ids at this fork — the parent's own tail first, then
   * the branches, oldest first. */
  readonly siblings: readonly string[];
  /** Which sibling the view path currently follows. */
  readonly currentIndex: number;
}

/**
 * The fork groups visible along a view path, keyed by message sequence — the
 * navigator renders under the message at that sequence. For each node the
 * path visits, its forks BEFORE the point where the path leaves it are still
 * part of the view (the copied prefix is shared); forks after it belong to a
 * tail the view replaced. A deeper node's fork at the same sequence wins —
 * its copy is the message actually on screen.
 */
export function forkGroupsForPath(
  path: readonly string[],
  branches: readonly BranchInfo[],
): ReadonlyMap<number, BranchForkGroup> {
  const groups = new Map<number, BranchForkGroup>();
  for (let index = 0; index < path.length; index += 1) {
    const node = path[index];
    if (node === undefined) continue;
    const following = path[index + 1];
    const nodeBranches = branches.filter((branch) => branch.parentId === node);
    const jumpSequence =
      following === undefined
        ? undefined
        : nodeBranches.find((branch) => branch.id === following)?.forkSequence;

    const bySequence = new Map<number, BranchInfo[]>();
    for (const branch of nodeBranches) {
      const bucket = bySequence.get(branch.forkSequence);
      if (bucket) bucket.push(branch);
      else bySequence.set(branch.forkSequence, [branch]);
    }

    for (const [sequence, group] of bySequence) {
      if (jumpSequence !== undefined && sequence > jumpSequence) continue;
      const ordered = [...group].sort((a, b) => a.createdAt - b.createdAt);
      const siblings = [node, ...ordered.map((branch) => branch.id)];
      const currentIndex =
        following !== undefined && sequence === jumpSequence
          ? Math.max(0, siblings.indexOf(following))
          : 0;
      groups.set(sequence, {
        parentId: node,
        forkSequence: sequence,
        siblings,
        currentIndex,
      });
    }
  }
  return groups;
}
