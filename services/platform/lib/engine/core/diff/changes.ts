/**
 * What a diff comes down to for the readers that do not show it in full: the
 * change summary a version keeps (what it changed against the version saved
 * before it — counts and flags only, never content, so a history lists it
 * without loading two documents), and the nodes the editor rings when
 * another window or a coding agent saves a version.
 */

import type { AutomationDiff } from './automation';

/**
 * What a version changed, as counts and flags. `first` marks an
 * automation's first version, which changed nothing against an earlier one
 * and only says how many nodes it starts with; `identical` a version whose
 * document is the one before it (a new message, a restored copy, a change
 * only to what the diff ignores). A flag is present only when set.
 */
export interface ChangeSummary {
  first?: true;
  identical?: true;
  nodes: { added: number; removed: number; changed: number; renamed?: number };
  /** The run input's schema changed. */
  inputs?: true;
  output?: true;
  description?: true;
  tests?: true;
  /** Another top-level key changed: the document's `version` or `name`, or
   * a key the grammar does not know. */
  other?: true;
  /** The version's settings, task contract or presentation changed. */
  package?: true;
}

/** The change summary of a diff; `first` overrides the diff's own. */
export function changeSummaryOf(
  diff: AutomationDiff,
  options: { first?: boolean } = {},
): ChangeSummary {
  const { added, removed, changed, renamed } = diff.counts;
  if (options.first ?? diff.first) {
    return { first: true, nodes: { added, removed: 0, changed: 0 } };
  }
  const summary: ChangeSummary = { nodes: { added, removed, changed } };
  if (renamed > 0) summary.nodes.renamed = renamed;
  if (diff.identical) summary.identical = true;
  if (diff.inputs.length > 0) summary.inputs = true;
  // An output that only reads a renamed node by its new id changed with the
  // rename, which the summary already counts.
  if (diff.output !== null && diff.output.referencesOnly === undefined) {
    summary.output = true;
  }
  if (diff.description !== null) summary.description = true;
  if (diff.tests.length > 0) summary.tests = true;
  if (diff.other.length > 0) summary.other = true;
  if (diff.package.length > 0) summary.package = true;
  return summary;
}

/** The nodes of the later document that differ from the earlier one: added,
 * changed (a reference to a renamed node included) and renamed, by their
 * new ids. */
export function changedNodeIds(diff: AutomationDiff): ReadonlySet<string> {
  return new Set(
    diff.nodes.filter((node) => node.kind !== 'removed').map((node) => node.id),
  );
}
