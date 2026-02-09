import { z } from 'zod/v4';

import { dataSourceSchema } from './common';
import { jsonRecordSchema } from './utils/json-value';

const customerStatusLiterals = ['active', 'churned', 'potential'] as const;
export const customerStatusSchema = z.enum(customerStatusLiterals);
type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const customerSourceSchema = dataSourceSchema;
type CustomerSource = z.infer<typeof customerSourceSchema>;

export const customerAddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
});
type CustomerAddress = z.infer<typeof customerAddressSchema>;

export const customerSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  status: customerStatusSchema.optional(),
  source: customerSourceSchema,
  locale: z.string().optional(),
  address: customerAddressSchema.optional(),
  metadata: jsonRecordSchema.optional(),
});
type Customer = z.infer<typeof customerSchema>;
