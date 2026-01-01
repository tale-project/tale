/**
 * Convex validators for customer operations
 */

import { v } from 'convex/values';

import { dataSourceValidator } from '../common/validators';

/**
 * Customer status validator
 */
export const customerStatusValidator = v.union(
  v.literal('active'),
  v.literal('churned'),
  v.literal('potential'),
);

/**
 * Customer source validator (alias for dataSourceValidator)
 */
export const customerSourceValidator = dataSourceValidator;

/**
 * Customer address validator
 */
export const customerAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

/**
 * Customer document validator (matches schema)
 */
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
  metadata: v.optional(v.any()),
});
