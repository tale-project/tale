/**
 * Convex validators for tone of voice operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  toneOfVoiceSchema,
  exampleMessageSchema,
  toneOfVoiceWithExamplesSchema,
  exampleMessageContentSchema,
  generateToneResponseSchema,
} from '../../lib/shared/schemas/tone_of_voice';

export {
  toneOfVoiceSchema,
  exampleMessageSchema,
  toneOfVoiceWithExamplesSchema,
  exampleMessageContentSchema,
  generateToneResponseSchema,
} from '../../lib/shared/schemas/tone_of_voice';

export const toneOfVoiceValidator = zodToConvex(toneOfVoiceSchema);
export const exampleMessageValidator = zodToConvex(exampleMessageSchema);
export const toneOfVoiceWithExamplesValidator = zodToConvex(toneOfVoiceWithExamplesSchema);
export const exampleMessageContentValidator = zodToConvex(exampleMessageContentSchema);
export const generateToneResponseValidator = zodToConvex(generateToneResponseSchema);
