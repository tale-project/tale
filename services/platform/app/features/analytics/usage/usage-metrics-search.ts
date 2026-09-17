import { metricsPeriodSearchSchema } from '@tale/ui/metrics/metrics-period';
import { z } from 'zod';

export const usageSearchSchema = metricsPeriodSearchSchema.extend({
  granularity: z.enum(['daily', 'weekly', 'monthly']).catch('daily').optional(),
  metric: z.enum(['tokens', 'requests', 'cost']).catch('tokens').optional(),
});
