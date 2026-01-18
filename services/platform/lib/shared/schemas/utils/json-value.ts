import { z } from 'zod/v4';
import { v } from 'convex/values';

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
