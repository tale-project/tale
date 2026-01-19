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

const jsonValueLevel8Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonPrimitiveValidator),
	v.record(v.string(), jsonPrimitiveValidator),
);

const jsonValueLevel7Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel8Validator),
	v.record(v.string(), jsonValueLevel8Validator),
);

const jsonValueLevel6Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel7Validator),
	v.record(v.string(), jsonValueLevel7Validator),
);

const jsonValueLevel5Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel6Validator),
	v.record(v.string(), jsonValueLevel6Validator),
);

const jsonValueLevel4Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel5Validator),
	v.record(v.string(), jsonValueLevel5Validator),
);

const jsonValueLevel3Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel4Validator),
	v.record(v.string(), jsonValueLevel4Validator),
);

const jsonValueLevel2Validator = v.union(
	jsonPrimitiveValidator,
	v.array(jsonValueLevel3Validator),
	v.record(v.string(), jsonValueLevel3Validator),
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

export const jsonRecordValidator = v.record(v.string(), jsonValueValidator);

// Convex-compatible types (use these instead of JsonValue/JsonRecord when passing to Convex functions)
export type ConvexJsonValue = Infer<typeof jsonValueValidator>;
export type ConvexJsonRecord = Infer<typeof jsonRecordValidator>;
