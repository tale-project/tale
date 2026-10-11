import { z } from 'zod';

/**
 * The Editor tab's search params: `?version=<n>` shows that stored version on
 * the canvas, absent means the latest; `?view=` picks the chart, the List
 * view or the Source view; `?node=<id>` opens a node (or `__start`,
 * `__end`) on load, so a link lands on it; `?panel=` opens the panel under
 * the canvas on Problems or Tests, and `?test=<n>` opens the test at that
 * place (counted from 0, as the document's pointers count it);
 * `?saveRun=<id>` opens that run saved as a test, to add to the draft (the
 * run page's Save as test lands here). A malformed value reads as absent
 * rather than failing the route — a bad link should still open the
 * automation.
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
  panel: z.enum(['problems', 'tests']).optional().catch(undefined),
  test: z.number().int().min(0).max(49).optional().catch(undefined),
  saveRun: z.string().min(1).max(128).optional().catch(undefined),
});

export type AutomationEditorSearch = z.infer<
  typeof automationEditorSearchSchema
>;

export type AutomationEditorView = NonNullable<AutomationEditorSearch['view']>;

/** The panel under the editor's canvas. */
export type AutomationEditorPanel = NonNullable<
  AutomationEditorSearch['panel']
>;

/** What the editor writes back as the reader moves: `null` clears it. */
export interface AutomationEditorSearchChange {
  view?: AutomationEditorView;
  node?: string | null;
  panel?: AutomationEditorPanel | null;
  test?: number | null;
  saveRun?: null;
}

/** The search after the reader moved: each change set or cleared, the rest
 * as it was. */
export function applyEditorSearchChange(
  previous: AutomationEditorSearch,
  change: AutomationEditorSearchChange,
): AutomationEditorSearch {
  const next: AutomationEditorSearch = { ...previous };
  if (change.view !== undefined) next.view = change.view;
  if (change.node === null) delete next.node;
  else if (change.node !== undefined) next.node = change.node;
  if (change.panel === null) delete next.panel;
  else if (change.panel !== undefined) next.panel = change.panel;
  if (change.test === null) delete next.test;
  else if (change.test !== undefined) next.test = change.test;
  if (change.saveRun === null) delete next.saveRun;
  return next;
}

/** The search on another version: the view, the open node, the panel and
 * the open test stay with the reader. */
export function editorSearchForVersion(
  previous: AutomationEditorSearch,
  version: number | undefined,
): AutomationEditorSearch {
  return {
    ...(previous.view !== undefined && { view: previous.view }),
    ...(previous.node !== undefined && { node: previous.node }),
    ...(previous.panel !== undefined && { panel: previous.panel }),
    ...(previous.test !== undefined && { test: previous.test }),
    ...(version !== undefined && { version }),
  };
}

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
