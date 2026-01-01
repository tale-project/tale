/**
 * Common Convex validators shared across multiple models
 */

import { v } from 'convex/values';

/**
 * Sort order validator
 * Used for pagination and list queries across multiple models
 */
export const sortOrderValidator = v.union(v.literal('asc'), v.literal('desc'));

/**
 * Priority validator
 * Used for approvals, conversations, and other prioritized items
 */
export const priorityValidator = v.union(
  v.literal('low'),
  v.literal('medium'),
  v.literal('high'),
  v.literal('urgent'),
);

/**
 * Data source validator
 * Used for customers, vendors, and other imported entities
 */
export const dataSourceValidator = v.union(
  v.literal('manual_import'),
  v.literal('file_upload'),
  v.literal('circuly'),
);
