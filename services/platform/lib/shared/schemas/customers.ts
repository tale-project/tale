import { z } from 'zod';
import { dataSourceSchema } from './common';
import { jsonRecordSchema } from './utils/json-value';

export const customerStatusLiterals = ['active', 'churned', 'potential'] as const;
export const customerStatusSchema = z.enum(customerStatusLiterals);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const customerSourceSchema = dataSourceSchema;
export type CustomerSource = z.infer<typeof customerSourceSchema>;

export const customerAddressSchema = z.object({
	street: z.string().optional(),
	city: z.string().optional(),
	state: z.string().optional(),
	country: z.string().optional(),
	postalCode: z.string().optional(),
});
export type CustomerAddress = z.infer<typeof customerAddressSchema>;

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
export type Customer = z.infer<typeof customerSchema>;
