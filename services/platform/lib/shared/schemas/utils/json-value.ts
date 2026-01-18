import { z } from 'zod/v4';
import { v, Infer } from 'convex/values';

export type JsonValue =
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

const jsonPrimitiveValidator = v.union(
	v.string(),
	v.number(),
	v.boolean(),
	v.null(),
);

const jsonValueLevel2Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonPrimitiveValidator),
	v.record(v.string(), jsonPrimitiveValidator),
);

const jsonValueLevel1Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel2Validator),
	v.record(v.string(), jsonValueLevel2Validator),
);

export const jsonValueValidator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel1Validator),
	v.record(v.string(), jsonValueLevel1Validator),
);

export const jsonRecordValidator = v.record(v.string(), jsonValueLevel1Validator);

// Convex-compatible types (use these instead of JsonValue/JsonRecord when passing to Convex functions)
export type ConvexJsonValue = Infer<typeof jsonValueValidator>;
export type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;
