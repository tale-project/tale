/**
 * Where a run page opens, as its URL says: the view, the step it shows and
 * which of its items or passes, the inspector's tab, and the moment of the
 * run — so a link to "the moment it failed" opens there. Each part that
 * does not read is dropped rather than refused: an old or hand-edited link
 * still opens the run.
 */

import { z } from 'zod';

import { flowGraphTarget } from './flow-ids';

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

/** The two runs a comparison shows, A and B, by their ids. */
export const runCompareSearchSchema = z.object({
  a: z.string().max(120).optional().catch(undefined),
  b: z.string().max(120).optional().catch(undefined),
});
