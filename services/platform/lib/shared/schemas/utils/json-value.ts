import { v, Infer } from 'convex/values';

export const jsonValueValidator = v.any();

export const jsonRecordValidator = v.any();

// Convex-compatible types (use these instead of JsonValue/JsonRecord when passing to Convex functions)
export type ConvexJsonValue = Infer<typeof jsonValueValidator>;
export type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;
