import { z } from 'zod/v4';
import { jsonRecordSchema, jsonValueSchema } from './utils/json-value';
import { dataSourceSchema } from './common';

export const vendorSourceSchema = dataSourceSchema;
type VendorSource = z.infer<typeof vendorSourceSchema>;

export const vendorAddressSchema = z.object({
	street: z.string().optional(),
	city: z.string().optional(),
	state: z.string().optional(),
	country: z.string().optional(),
	postalCode: z.string().optional(),
});
type VendorAddress = z.infer<typeof vendorAddressSchema>;

export const vendorItemSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	name: z.string().optional(),
	email: z.string().optional(),
	phone: z.string().optional(),
	externalId: z.union([z.string(), z.number()]).optional(),
	source: vendorSourceSchema,
	locale: z.string().optional(),
	address: vendorAddressSchema.optional(),
	tags: z.array(z.string()).optional(),
	metadata: jsonRecordSchema.optional(),
	notes: z.string().optional(),
});
type VendorItem = z.infer<typeof vendorItemSchema>;

export const vendorInputSchema = z.object({
	name: z.string().optional(),
	email: z.string(),
	phone: z.string().optional(),
	externalId: z.union([z.string(), z.number()]).optional(),
	source: vendorSourceSchema,
	locale: z.string().optional(),
	address: vendorAddressSchema.optional(),
	tags: z.array(z.string()).optional(),
	metadata: jsonRecordSchema.optional(),
	notes: z.string().optional(),
});
type VendorInput = z.infer<typeof vendorInputSchema>;

export const vendorListResponseSchema = z.object({
	items: z.array(vendorItemSchema),
	total: z.number(),
	page: z.number(),
	pageSize: z.number(),
	totalPages: z.number(),
	hasNextPage: z.boolean(),
	hasPreviousPage: z.boolean(),
});
type VendorListResponse = z.infer<typeof vendorListResponseSchema>;

const bulkCreateErrorItemSchema = z.object({
	index: z.number(),
	error: z.string(),
	vendor: jsonValueSchema,
});
type BulkCreateErrorItem = z.infer<typeof bulkCreateErrorItemSchema>;

export const bulkCreateVendorsResponseSchema = z.object({
	success: z.number(),
	failed: z.number(),
	errors: z.array(bulkCreateErrorItemSchema),
});
type BulkCreateVendorsResponse = z.infer<typeof bulkCreateVendorsResponseSchema>;
