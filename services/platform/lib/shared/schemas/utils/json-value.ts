import { z } from 'zod/v4';
import { v, Infer } from 'convex/values';

type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export const jsonRecordSchema = z.record(z.string(), jsonValueSchema);
export type JsonRecord = z.infer<typeof jsonRecordSchema>;

export const jsonValueValidator = v.any();

export const jsonRecordValidator = v.any();

// Convex-compatible types (use these instead of JsonValue/JsonRecord when passing to Convex functions)
export type ConvexJsonValue = Infer<typeof jsonValueValidator>;
export type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;
