/**
 * Zod-free JSON value validators for Convex
 *
 * These mirror jsonRecordValidator/jsonValueValidator from lib/shared/schemas/utils/json-value.ts
 * but without importing zod, keeping query bundles lean.
 */

import type { Infer } from 'convex/values';

import { v } from 'convex/values';

export const jsonValueValidator = v.any();

export const jsonRecordValidator = v.any();

export type ConvexJsonValue = Infer<typeof jsonValueValidator>;
export type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;
