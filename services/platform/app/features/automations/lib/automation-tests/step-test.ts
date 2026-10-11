/**
 * What testing one node alone needs from its author, as the engine's bench
 * runs it (`only`): data for every node it reads — pinned in their place
 * and never run — the run's input when it reads that, and which item when
 * it runs once per item.
 */

import { readsOf } from '@/lib/engine/core/execute/bench';
import { sourcesOf } from '@/lib/engine/core/syntax/sources';
import type { Automation, NodeDef } from '@/lib/engine/core/types';

export interface StepTestNeeds {
  node: NodeDef;
  /** The nodes it reads, in document order: each needs data. */
  reads: string[];
  /** It reads the run's input — not a code step's own `input`, which is
   * the node's resolved input. */
  readsInput: boolean;
  /** It runs once per item: a test of it runs one item. */
  perItem: boolean;
}

/** What testing `nodeId` alone needs; null for a node the document lacks. */
export function stepTestNeeds(
  doc: Pick<Automation, 'nodes'>,
  nodeId: string,
): StepTestNeeds | null {
  const byId = new Map(doc.nodes.map((node) => [node.id, node]));
  const node = byId.get(nodeId);
  if (node === undefined) return null;
  const reads = new Set(readsOf(node, byId));
  return {
    node,
    reads: doc.nodes.flatMap((each) => (reads.has(each.id) ? [each.id] : [])),
    readsInput: sourcesOf(node).some(
      (source) =>
        source.field !== 'code' &&
        source.units.some((unit) =>
          unit.refs.some((ref) => ref.root === 'input'),
        ),
    ),
    perItem: typeof node.forEach === 'string',
  };
}

/** What a step test ran with, kept for the session so testing the same
 * node again starts from it. */
export interface StepTestPins {
  pins: Readonly<Record<string, unknown>>;
  input: unknown;
  item: number;
}

const remembered = new Map<string, StepTestPins>();

/** The pins last used for `key` (an automation's node) this session. */
export function recalledPins(key: string): StepTestPins | undefined {
  return remembered.get(key);
}

/** Keeps the pins `key` ran with for the rest of the session. */
export function rememberPins(key: string, pins: StepTestPins): void {
  remembered.set(key, pins);
}
