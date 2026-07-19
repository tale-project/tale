import { z } from 'zod';

/**
 * URL search schema for Settings → Metrics → Chat health. The router parses a
 * bare `?period=30` as the JSON number 30, which fails a plain string enum and
 * crashes the page via SearchParamError — coerce to a string first, then fall
 * back so a shared/bookmarked URL never renders the error boundary. Same bug
 * class as the feedback metrics search schema (issue #2034).
 */
export const chatHealthMetricsSearchSchema = z.object({
  period: z.coerce
    .string()
    .pipe(z.enum(['1', '7', '30']))
    .catch('7')
    .optional(),
});

export type ChatHealthMetricsSearch = z.infer<
  typeof chatHealthMetricsSearchSchema
>;
