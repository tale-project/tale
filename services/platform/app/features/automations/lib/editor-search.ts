import { z } from 'zod';

/**
 * The Editor tab's search params: `?version=<n>` shows that stored version on
 * the canvas, absent means the latest. A malformed value reads as absent
 * rather than failing the route — a bad link should still open the automation.
 */
export const automationEditorSearchSchema = z.object({
  version: z.number().int().positive().optional().catch(undefined),
});

export type AutomationEditorSearch = z.infer<
  typeof automationEditorSearchSchema
>;
