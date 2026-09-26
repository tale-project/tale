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
 *
 * Shared between the app (the navigator) and the backend (a share link
 * freezes the leaf the owner sees) — both hold identical inputs.
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
  /** The shallowest path node that forks at this sequence — the node whose
   * own tail is the group's first sibling and whose selection key the
   * navigator writes first. */
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
 * tail the view replaced.
 *
 * Two path nodes forking at the SAME sequence are one fork point: a branch
 * taken from a sibling (B1 → B2, both at sequence S) is another version of
 * the same turn, not a fork of a fork. The server flattens new forks onto
 * the shallowest owner, and the groups merge here so a lineage written
 * before it did reads the same way — every version reachable, the original
 * included. A path node that does NOT fork at the merged sequence (it was
 * forked later, so its message at S is the copied one) adds no entry of its
 * own: the entry already standing for its predecessor is the message on
 * screen.
 */
export function forkGroupsForPath(
  path: readonly string[],
  branches: readonly BranchInfo[],
): ReadonlyMap<number, BranchForkGroup> {
  const createdAt = new Map(
    branches.map((branch) => [branch.id, branch.createdAt] as const),
  );
  const byCreation = (a: string, b: string): number =>
    (createdAt.get(a) ?? 0) - (createdAt.get(b) ?? 0);
  const groups = new Map<
    number,
    { parentId: string; forkSequence: number; siblings: string[] }
  >();
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
      // Every version of this turn reachable from the node: its own forks
      // at the sequence, and — on a lineage written before forks were
      // flattened — the forks THOSE carry at the same sequence, and so on.
      const ids: string[] = [];
      const seen = new Set<string>([node]);
      const queue = group.map((branch) => branch.id);
      while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        for (const branch of branches) {
          if (branch.parentId === id && branch.forkSequence === sequence) {
            queue.push(branch.id);
          }
        }
      }
      const existing = groups.get(sequence);
      if (existing === undefined) {
        groups.set(sequence, {
          parentId: node,
          forkSequence: sequence,
          siblings: [node, ...ids.sort(byCreation)],
        });
        continue;
      }
      // Merge: the shallower node keeps the anchor; every version — the
      // earlier list's and this node's — sits after it in creation order.
      const [anchor, ...rest] = existing.siblings;
      const merged = new Set([...rest, ...ids]);
      merged.delete(anchor ?? '');
      existing.siblings = [anchor ?? node, ...[...merged].sort(byCreation)];
    }
  }

  const out = new Map<number, BranchForkGroup>();
  for (const [sequence, group] of groups) {
    // The version on screen is the DEEPEST path member the group lists — a
    // path node the group does not list shows its predecessor's copy.
    let currentIndex = 0;
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const member = path[index];
      const at = member === undefined ? -1 : group.siblings.indexOf(member);
      if (at >= 0) {
        currentIndex = at;
        break;
      }
    }
    out.set(sequence, {
      parentId: group.parentId,
      forkSequence: sequence,
      siblings: group.siblings,
      currentIndex,
    });
  }
  return out;
}

export interface BranchSelectionEntry {
  readonly forkKey: string;
  readonly selectedThreadId: string;
}

/**
 * Every selection key that makes `chosen` the version a fork point shows,
 * given the path on screen. For a flat fork point that is one key
 * (`anchor:S → chosen`). For a lineage written before the server flattened
 * forks (R → B1 → B2 at S), `chosen` may hang off an intermediate sibling:
 * each ancestor forking at S gets its own key, root-most first. Every other
 * path node forking at S — and the chosen sibling itself when versions hang
 * below it — is pinned to its own tail, so a deeper choice stored earlier
 * cannot carry the view past the version just chosen.
 */
export function selectionChainFor(
  forkSequence: number,
  chosen: string,
  path: readonly string[],
  branches: readonly BranchInfo[],
): BranchSelectionEntry[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch] as const));
  // Climb from the chosen sibling through same-sequence forks to the node
  // whose prefix they all edit — a path member (the anchor, or a sibling
  // forked later whose copy at S is the anchor's).
  const chain: string[] = [];
  let top = chosen;
  for (let guard = 0; guard < 50; guard += 1) {
    const branch = byId.get(top);
    if (branch === undefined || branch.forkSequence !== forkSequence) break;
    chain.unshift(top);
    top = branch.parentId;
  }
  const entries: BranchSelectionEntry[] = [];
  const edgeParents = new Set<string>();
  let parent = top;
  for (const step of chain) {
    entries.push({
      forkKey: forkKey(parent, forkSequence),
      selectedThreadId: step,
    });
    edgeParents.add(parent);
    parent = step;
  }
  const forksAt = (id: string): boolean =>
    branches.some(
      (branch) =>
        branch.parentId === id && branch.forkSequence === forkSequence,
    );
  for (const node of new Set([...path, chosen])) {
    if (edgeParents.has(node) || !forksAt(node)) continue;
    entries.push({
      forkKey: forkKey(node, forkSequence),
      selectedThreadId: node,
    });
  }
  return entries;
}
