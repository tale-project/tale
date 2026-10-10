/**
 * The ids the canvas gives what a document does not name: Start, End and
 * each node's condition. A document node id matches
 * `^[a-z][a-z0-9_]{0,49}$`, so none of these can collide with one.
 *
 * Kept apart from `./flow-graph`, which parses the document: the Problems
 * counts and the editor's selection only need the ids.
 */

export const START_ID = '__start';
export const END_ID = '__end';
const GATE_PREFIX = '__gate:';

/** The condition drawn above node `nodeId`. */
export const gateIdOf = (nodeId: string): string => `${GATE_PREFIX}${nodeId}`;

/** The key a path's decision for a node's condition goes by (the flow
 *  analysis's atom id). */
export const decisionKeyOf = (nodeId: string): string => `when:${nodeId}`;

/** What a graph id stands for in the document. */
export type FlowGraphTarget =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'gate'; nodeId: string }
  | { kind: 'node'; nodeId: string };

export function flowGraphTarget(id: string): FlowGraphTarget {
  if (id === START_ID) return { kind: 'start' };
  if (id === END_ID) return { kind: 'end' };
  if (id.startsWith(GATE_PREFIX)) {
    return { kind: 'gate', nodeId: id.slice(GATE_PREFIX.length) };
  }
  return { kind: 'node', nodeId: id };
}
