import { z } from 'zod';

/** URL search schema for Settings → Metrics → Feedback (#2034 coercion). */
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
