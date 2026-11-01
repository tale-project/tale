/**
 * The limits a run's walk keeps, whichever host walks it — the durable
 * stepper (`backend/core/automations/stepper.ts`) or the in-process executor
 * (`../execute`). One copy, so the two cannot drift apart.
 *
 * A leaf: the typing and analysis layers and the editor read these too, so
 * nothing here may reach the parser, the schema validator or the YAML loader
 * (`selftest/purity.test.ts`).
 */

import type { NodeDef } from '../types';

/** How deep subautomations nest: the top-level run is depth 0, and a
 * subautomation node in a document at this depth fails. */
export const MAX_SUBAUTOMATION_DEPTH = 3;

/** Node executions one run may perform, `forEach` items and `repeatUntil`
 * passes included — the guard against a runaway loop. The in-process
 * executor's caller may set another (`maxNodes`). */
export const DEFAULT_MAX_NODE_EXECUTIONS = 100;

/** Passes a `repeatUntil` node runs at most: `maxRepeats` (5 when unset),
 * never more than 20 — what a walk loops, and what the analysis says a
 * condition that never holds costs. */
export function maxRepeatsOf(n: Pick<NodeDef, 'maxRepeats'>): number {
  return Math.min(n.maxRepeats ?? 5, 20);
}
