import type { FlowGraph } from './types';

/**
 * Throws on a graph the canvas cannot draw truthfully: a repeated id, an
 * edge to a node that is not there, more than one Start or End, a gate with
 * the wrong edges out, a frame around something other than steps, or a
 * frame a path leaves and re-enters (its members would not sit together).
 *
 * The canvas runs it in development builds and tests; a host's adapter
 * tests should run it over every graph they build.
 */
export function validateFlowGraph(graph: FlowGraph): void {
  const problems = flowGraphProblems(graph);
  if (problems.length > 0) {
    throw new Error(`Invalid flow graph:\n  ${problems.join('\n  ')}`);
  }
}

/** What {@link validateFlowGraph} would refuse, one sentence each; empty
 *  for a graph the canvas can draw. */
export function flowGraphProblems(graph: FlowGraph): string[] {
  const problems: string[] = [];
  const kinds = new Map<string, string>();
  for (const node of graph.nodes) {
    if (kinds.has(node.id)) problems.push(`duplicate node id "${node.id}"`);
    kinds.set(node.id, node.kind);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id "${edge.id}"`);
    edgeIds.add(edge.id);
    if (!kinds.has(edge.source))
      problems.push(
        `edge "${edge.id}" starts at unknown node "${edge.source}"`,
      );
    if (!kinds.has(edge.target))
      problems.push(`edge "${edge.id}" ends at unknown node "${edge.target}"`);
    if (edge.source === edge.target)
      problems.push(`edge "${edge.id}" loops on "${edge.source}"`);
  }
  const count = (kind: string) =>
    graph.nodes.filter((node) => node.kind === kind).length;
  if (count('entry') > 1) problems.push('more than one entry node');
  if (count('exit') > 1) problems.push('more than one exit node');

  for (const node of graph.nodes) {
    if (node.kind !== 'gate') continue;
    const out = graph.edges.filter(
      (edge) => edge.source === node.id && !edge.layoutOnly,
    );
    const has = (kind: string) => out.some((edge) => edge.kind === kind);
    if (node.mode === 'only-if' && !has('gate'))
      problems.push(`only-if gate "${node.id}" has no gate edge out`);
    if (node.mode === 'if-else' && !(has('branch-yes') && has('branch-no')))
      problems.push(`if-else gate "${node.id}" needs a Yes and a No edge out`);
  }
  for (const edge of graph.edges) {
    if (
      (edge.kind === 'gate' ||
        edge.kind === 'branch-yes' ||
        edge.kind === 'branch-no') &&
      kinds.get(edge.source) !== 'gate'
    )
      problems.push(`${edge.kind} edge "${edge.id}" does not leave a gate`);
  }

  const successors = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = successors.get(edge.source);
    if (list) list.push(edge.target);
    else successors.set(edge.source, [edge.target]);
  }
  const framed = new Set<string>();
  for (const group of graph.groups ?? []) {
    if (group.members.length === 0)
      problems.push(`group "${group.id}" has no members`);
    for (const member of group.members) {
      if (kinds.get(member) !== 'step')
        problems.push(`group "${group.id}" holds "${member}", not a step`);
      if (framed.has(member))
        problems.push(`"${member}" sits in more than one group`);
      framed.add(member);
    }
    // Convex: no path from one member back to another leaves the group.
    const inside = new Set(group.members);
    for (const member of group.members) {
      const stack = (successors.get(member) ?? []).filter(
        (id) => !inside.has(id),
      );
      const seen = new Set<string>();
      for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
        if (seen.has(id)) continue;
        seen.add(id);
        for (const next of successors.get(id) ?? []) {
          if (inside.has(next)) {
            problems.push(
              `group "${group.id}" is not convex: a path from "${member}" leaves it and returns at "${next}"`,
            );
            stack.length = 0;
            break;
          }
          stack.push(next);
        }
      }
    }
  }
  return problems;
}
