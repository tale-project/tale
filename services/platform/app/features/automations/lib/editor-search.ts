import { z } from 'zod';

/**
 * The Editor tab's search params: `?version=<n>` shows that stored version on
 * the canvas, absent means the latest; `?view=` picks the chart or the List
 * view; `?node=<id>` opens a node (or `__start`, `__end`) on load, so a link
 * lands on it. A malformed value reads as absent rather than failing the
 * route — a bad link should still open the automation.
 */
export const automationEditorSearchSchema = z.object({
  history: z.boolean().optional().catch(undefined),
  version: z.number().int().positive().optional().catch(undefined),
  view: z.enum(['canvas', 'list']).optional().catch(undefined),
  node: z
    .string()
    .regex(/^(?:__start|__end|[a-z][a-z0-9_]{0,49})$/)
    .optional()
    .catch(undefined),
});

export type AutomationEditorView = NonNullable<
  z.infer<typeof automationEditorSearchSchema>['view']
>;
