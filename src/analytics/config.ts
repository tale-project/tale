import { z } from 'zod';

export const ANALYTICS_CONFIG_ID = 'tale-analytics';

export const publicAnalyticsSchema = z.object({
  websiteId: z.uuid(),
  proxyPath: z.string().regex(/^\/(?:[a-zA-Z0-9_-]+\/)*_a$/),
});

/** Only these explicit outcomes may be counted; never accept arbitrary event data. */
export const analyticsEventSchema = z.enum([
  'contact-submitted',
  'demo-request-submitted',
]);
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

export const analyticsPayloadSchema = z.object({
  website: z.uuid(),
  url: z
    .string()
    .max(500)
    .regex(/^\/[a-zA-Z0-9_/:$.-]*$/),
  hostname: z.string().max(253),
  language: z
    .string()
    .max(35)
    .regex(/^[a-zA-Z0-9-]*$/),
  screen: z.string().regex(/^\d{1,5}x\d{1,5}$/),
  referrer: z.string().max(300),
  name: analyticsEventSchema.optional(),
});

export type AnalyticsPayload = z.infer<typeof analyticsPayloadSchema>;

/** An origin is useful for acquisition without retaining source paths or queries. */
export function analyticsReferrer(value: string, ownOrigin: string): string {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      url.origin !== ownOrigin
      ? url.origin
      : '';
  } catch {
    return '';
  }
}
