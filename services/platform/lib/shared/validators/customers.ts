import { z } from 'zod';
import { v } from 'convex/values';
import { createEnumValidator } from './utils/zod-to-convex';
import { dataSourceSchema, dataSourceValidator } from './common';
import { jsonRecordSchema, jsonRecordValidator } from './utils/json-value';

export const customerStatusLiterals = ['active', 'churned', 'potential'] as const;
export const { zodSchema: customerStatusSchema, convexValidator: customerStatusValidator } =
	createEnumValidator(customerStatusLiterals);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const customerSourceSchema = dataSourceSchema;
export const customerSourceValidator = dataSourceValidator;

export const customerAddressSchema = z.object({
	street: z.string().optional(),
	city: z.string().optional(),
	state: z.string().optional(),
	country: z.string().optional(),
	postalCode: z.string().optional(),
});

export const customerAddressValidator = v.object({
	street: v.optional(v.string()),
	city: v.optional(v.string()),
	state: v.optional(v.string()),
	country: v.optional(v.string()),
	postalCode: v.optional(v.string()),
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

export const customerValidator = v.object({
	_id: v.id('customers'),
	_creationTime: v.number(),
	organizationId: v.string(),
	name: v.optional(v.string()),
	email: v.optional(v.string()),
	externalId: v.optional(v.union(v.string(), v.number())),
	status: v.optional(customerStatusValidator),
	source: customerSourceValidator,
	locale: v.optional(v.string()),
	address: v.optional(customerAddressValidator),
	metadata: v.optional(jsonRecordValidator),
});

export type Customer = z.infer<typeof customerSchema>;
