import { z } from 'zod';
import { jsonRecordSchema } from './utils/json-value';

export const productStatusLiterals = ['active', 'inactive', 'draft', 'archived'] as const;
export const productStatusSchema = z.enum(productStatusLiterals);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const productSortByLiterals = ['name', 'createdAt', 'lastUpdated', 'stock', 'price'] as const;
export const productSortBySchema = z.enum(productSortByLiterals);
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
export type ProductItem = z.infer<typeof productItemSchema>;

export const productListResponseSchema = z.object({
	products: z.array(productItemSchema),
	total: z.number(),
	hasNextPage: z.boolean(),
	currentPage: z.number(),
	pageSize: z.number(),
	error: z.string().optional(),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;
