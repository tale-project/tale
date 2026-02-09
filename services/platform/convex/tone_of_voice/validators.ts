/**
 * Convex validators for tone of voice operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  exampleMessageContentSchema,
  generateToneResponseSchema,
} from '../../lib/shared/schemas/tone_of_voice';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  toneOfVoiceSchema,
  exampleMessageSchema,
  toneOfVoiceWithExamplesSchema,
  exampleMessageContentSchema,
  generateToneResponseSchema,
} from '../../lib/shared/schemas/tone_of_voice';

// Simple schemas without z.lazy()
export const exampleMessageContentValidator = zodToConvex(
  exampleMessageContentSchema,
);
export const generateToneResponseValidator = zodToConvex(
  generateToneResponseSchema,
);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const toneOfVoiceValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  generatedTone: v.optional(v.string()),
  lastUpdated: v.number(),
  metadata: v.optional(jsonRecordValidator),
});

export const exampleMessageValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  toneOfVoiceId: v.string(),
  content: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  metadata: v.optional(jsonRecordValidator),
});

export const toneOfVoiceWithExamplesValidator = v.object({
  toneOfVoice: toneOfVoiceValidator,
  examples: v.array(exampleMessageValidator),
});
