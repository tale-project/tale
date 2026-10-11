import { z } from 'zod';

/**
 * The Editor tab's search params: `?version=<n>` shows that stored version on
 * the canvas, absent means the latest; `?view=` picks the chart, the List
 * view or the Source view; `?node=<id>` opens a node (or `__start`,
 * `__end`) on load, so a link
 * lands on it. A malformed value reads as absent rather than failing the
 * route — a bad link should still open the automation.
 */
export const automationEditorSearchSchema = z.object({
  history: z.boolean().optional().catch(undefined),
  version: z.number().int().positive().optional().catch(undefined),
  view: z.enum(['canvas', 'list', 'source']).optional().catch(undefined),
  node: z
    .string()
    .regex(/^(?:__start|__end|[a-z][a-z0-9_]{0,49})$/)
    .optional()
    .catch(undefined),
});

export type AutomationEditorView = NonNullable<
  z.infer<typeof automationEditorSearchSchema>['view']
>;

/**
 * The Versions tab's search params: `?tab=deployments` shows when each
 * version went live instead of the versions themselves. A malformed value
 * reads as absent.
 */
export const automationVersionsSearchSchema = z.object({
  tab: z.enum(['versions', 'deployments']).optional().catch(undefined),
});

/**
 * A version comparison's search params: `?from=<n>` is the version compared
 * with (absent: the one before), `?view=` the Graph, the Changes or the YAML,
 * `?node=<id>` the node whose changes are open on the Graph. A malformed
 * value reads as absent.
 */
export const automationVersionCompareSearchSchema = z.object({
  from: z.number().int().positive().optional().catch(undefined),
  view: z.enum(['graph', 'changes', 'yaml']).optional().catch(undefined),
  node: z.string().min(1).max(200).optional().catch(undefined),
});

export type VersionCompareView = NonNullable<
  z.infer<typeof automationVersionCompareSearchSchema>['view']
>;

/** The version a comparison's address names: a whole number from 1 on,
 * else none. */
export function versionParam(raw: string): number | null {
  return /^[1-9]\d{0,8}$/.test(raw) ? Number(raw) : null;
}
