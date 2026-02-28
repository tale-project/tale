import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const websiteStatusLiterals = [
  'idle',
  'scanning',
  'active',
  'error',
  'deleting',
] as const;
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
  pageCount: z.number().optional(),
  crawledPageCount: z.number().optional(),
  metadata: jsonRecordSchema.optional(),
});

type Website = z.infer<typeof websiteSchema>;
