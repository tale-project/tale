import { z } from 'zod';

/**
 * URL search schema for Settings → Metrics → Feedback. The router parses a
 * bare `?period=90` (or `?comments=1`) as the JSON number 90/1, which fails a
 * plain string enum and crashes the page via SearchParamError (issue #2034).
 * Coerce to a string first, then fall back so a shared/bookmarked URL never
 * renders the error boundary. Same bug class as #1987 (agents), #2024
 * (automations), and #2033 (projects).
 */
export const feedbackMetricsSearchSchema = z.object({
  period: z.coerce
    .string()
    .pipe(z.enum(['1', '7', '30', '90', 'all']))
    .catch('7')
    .optional(),
  kind: z.enum(['all', 'message', 'arena']).optional(),
  comments: z.coerce
    .string()
    .pipe(z.enum(['1']))
    .optional()
    .catch(undefined),
  agent: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
});

export type FeedbackMetricsSearch = z.infer<typeof feedbackMetricsSearchSchema>;
