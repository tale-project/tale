import { v } from 'convex/values';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

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
