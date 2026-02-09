import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const websiteStatusLiterals = ['active', 'inactive', 'error'] as const;
export const websiteStatusSchema = z.enum(websiteStatusLiterals);
type WebsiteStatus = z.infer<typeof websiteStatusSchema>;

export const websiteSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  domain: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  scanInterval: z.string(),
  lastScannedAt: z.number().optional(),
  status: websiteStatusSchema.optional(),
  metadata: jsonRecordSchema.optional(),
});

type Website = z.infer<typeof websiteSchema>;

export const websitePageSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  websiteId: z.string(),
  url: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  wordCount: z.number().optional(),
  lastCrawledAt: z.number(),
  metadata: jsonRecordSchema.optional(),
  structuredData: jsonRecordSchema.optional(),
});

type WebsitePage = z.infer<typeof websitePageSchema>;
