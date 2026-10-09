/**
 * Where a run page opens, as its URL says: the view, the step it shows and
 * which of its items or passes, the inspector's tab, and the moment of the
 * run — so a link to "the moment it failed" opens there. Each part that
 * does not read is dropped rather than refused: an old or hand-edited link
 * still opens the run.
 */

import { z } from 'zod';

import { flowGraphTarget } from './flow-ids';
import type { RunUnitRef } from './run-timeline';

const RUN_INSPECTOR_TABS = [
  'error',
  'data',
  'conditions',
  'items',
  'effects',
  'attempts',
  'agent',
] as const;

export const runSearchSchema = z.object({
  view: z.enum(['canvas', 'steps']).optional().catch(undefined),
  node: z.string().max(120).optional().catch(undefined),
  tab: z.enum(RUN_INSPECTOR_TABS).optional().catch(undefined),
  item: z.coerce.number().int().min(0).optional().catch(undefined),
  pass: z.coerce.number().int().min(0).optional().catch(undefined),
  /** Real milliseconds since the run started. */
  t: z.coerce.number().int().min(0).optional().catch(undefined),
});

export type RunSearch = z.infer<typeof runSearchSchema>;

/** The step a link names, on the run's own terms: a condition drawn above
 * a step is that step's. */
export function runSearchNode(search: RunSearch): string | undefined {
  if (search.node === undefined) return undefined;
  const target = flowGraphTarget(search.node);
  if (target.kind === 'gate' || target.kind === 'node') return target.nodeId;
  return target.kind === 'start' ? '__start' : '__end';
}

/** The step a link opens on load, with its item or pass — none for Start
 * and End, which have no inspector of their own. */
export function runSearchSelection(search: RunSearch | undefined): {
  node: string | null;
  unit: RunUnitRef | null;
} {
  const node = search === undefined ? undefined : runSearchNode(search);
  if (node === undefined || node === '__start' || node === '__end')
    return { node: null, unit: null };
  const item = search?.item;
  const pass = search?.pass;
  return {
    node,
    unit:
      item === undefined && pass === undefined
        ? null
        : {
            ...(item !== undefined && { item }),
            ...(pass !== undefined && { pass }),
          },
  };
}

/** What the run page changed of its search: a value to write, `null` to
 * drop the key, left out to keep it. */
export interface RunSearchChange {
  view?: 'steps' | null;
  node?: string | null;
  item?: number | null;
  pass?: number | null;
  /** Real milliseconds since the run started. */
  t?: number | null;
}

/** The search after a change, keeping every key the change leaves out. */
export function applyRunSearchChange(
  previous: RunSearch,
  change: RunSearchChange,
): RunSearch {
  const next: RunSearch = { ...previous };
  if (change.view === null) delete next.view;
  else if (change.view !== undefined) next.view = change.view;
  if (change.node === null) delete next.node;
  else if (change.node !== undefined) next.node = change.node;
  if (change.item === null) delete next.item;
  else if (change.item !== undefined) next.item = change.item;
  if (change.pass === null) delete next.pass;
  else if (change.pass !== undefined) next.pass = change.pass;
  if (change.t === null) delete next.t;
  else if (change.t !== undefined) next.t = change.t;
  return next;
}

/** The two runs a comparison shows, A and B, by their ids. */
export const runCompareSearchSchema = z.object({
  a: z.string().max(120).optional().catch(undefined),
  b: z.string().max(120).optional().catch(undefined),
});
