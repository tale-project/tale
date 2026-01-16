import { z } from 'zod';
import { v } from 'convex/values';

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

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export const jsonValueValidator: typeof v.any = v.any();

export const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

export const jsonRecordValidator = v.record(v.string(), v.any());
