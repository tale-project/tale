import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const productStatusLiterals = [
  'active',
  'inactive',
  'draft',
  'archived',
] as const;
export const productStatusSchema = z.enum(productStatusLiterals);
type ProductStatus = z.infer<typeof productStatusSchema>;

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
type ProductTranslation = z.infer<typeof productTranslationSchema>;

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
type ProductItem = z.infer<typeof productItemSchema>;

const productDocSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  stock: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: productStatusSchema.optional(),
  translations: z.array(productTranslationSchema).optional(),
  lastUpdated: z.number().optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  metadata: jsonRecordSchema.optional(),
});
type ProductDoc = z.infer<typeof productDocSchema>;

const createProductArgsSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  stock: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: productStatusSchema.optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  metadata: jsonRecordSchema.optional(),
});
type CreateProductArgs = z.infer<typeof createProductArgsSchema>;

const updateProductArgsSchema = z.object({
  productId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  stock: z.number().optional(),
  price: z.number().optional(),
  currency: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: productStatusSchema.optional(),
  translations: z.array(productTranslationSchema).optional(),
  metadata: jsonRecordSchema.optional(),
});
type UpdateProductArgs = z.infer<typeof updateProductArgsSchema>;
