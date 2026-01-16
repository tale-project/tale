import { z } from 'zod';
import { v } from 'convex/values';
import { createEnumValidator } from './utils/zod-to-convex';
import { jsonRecordSchema, jsonRecordValidator } from './utils/json-value';

export const productStatusLiterals = ['active', 'inactive', 'draft', 'archived'] as const;
export const { zodSchema: productStatusSchema, convexValidator: productStatusValidator } =
	createEnumValidator(productStatusLiterals);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const productSortByLiterals = ['name', 'createdAt', 'lastUpdated', 'stock', 'price'] as const;
export const { zodSchema: productSortBySchema, convexValidator: productSortByValidator } =
	createEnumValidator(productSortByLiterals);
export type ProductSortBy = z.infer<typeof productSortBySchema>;

export const productTranslationSchema = z.object({
	language: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	tags: z.array(z.string()).optional(),
	metadata: jsonRecordSchema.optional(),
	createdAt: z.number().optional(),
	lastUpdated: z.number(),
});

export const productTranslationValidator = v.object({
	language: v.string(),
	name: v.optional(v.string()),
	description: v.optional(v.string()),
	category: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	metadata: v.optional(jsonRecordValidator),
	createdAt: v.optional(v.number()),
	lastUpdated: v.number(),
});

export type ProductTranslation = z.infer<typeof productTranslationSchema>;

export const productItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().optional(),
	imageUrl: z.string().optional(),
	stock: z.number().optional(),
	price: z.number().optional(),
	currency: z.string().optional(),
	category: z.string().optional(),
	tags: z.array(z.string()).optional(),
	status: productStatusSchema.optional(),
	lastUpdated: z.number(),
	createdAt: z.number(),
	relatedProductsCount: z.number().optional(),
	translations: z.array(productTranslationSchema).optional(),
	metadata: jsonRecordSchema.optional(),
});

export const productItemValidator = v.object({
	id: v.string(),
	name: v.string(),
	description: v.optional(v.string()),
	imageUrl: v.optional(v.string()),
	stock: v.optional(v.number()),
	price: v.optional(v.number()),
	currency: v.optional(v.string()),
	category: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	status: v.optional(productStatusValidator),
	lastUpdated: v.number(),
	createdAt: v.number(),
	relatedProductsCount: v.optional(v.number()),
	translations: v.optional(v.array(productTranslationValidator)),
	metadata: v.optional(jsonRecordValidator),
});

export type ProductItem = z.infer<typeof productItemSchema>;

export const productListResponseSchema = z.object({
	products: z.array(productItemSchema),
	total: z.number(),
	hasNextPage: z.boolean(),
	currentPage: z.number(),
	pageSize: z.number(),
	error: z.string().optional(),
});

export const productListResponseValidator = v.object({
	products: v.array(productItemValidator),
	total: v.number(),
	hasNextPage: v.boolean(),
	currentPage: v.number(),
	pageSize: v.number(),
	error: v.optional(v.string()),
});

export type ProductListResponse = z.infer<typeof productListResponseSchema>;
