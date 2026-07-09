/**
 * Convex validators for contact operations
 */

import { v } from 'convex/values';

import { dataSourceValidator } from '../lib/validators/common';
import { jsonRecordValidator } from '../lib/validators/json';

export const contactSourceValidator = dataSourceValidator;

export const contactAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  country: v.optional(v.string()),
  postalCode: v.optional(v.string()),
});

export const contactValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  externalId: v.optional(v.union(v.string(), v.number())),
  source: contactSourceValidator,
  locale: v.optional(v.string()),
  address: v.optional(contactAddressValidator),
  tags: v.optional(v.array(v.string())),
  metadata: v.optional(jsonRecordValidator),
  notes: v.optional(v.string()),
});
