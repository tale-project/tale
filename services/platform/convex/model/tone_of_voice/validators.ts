/**
 * Convex validators for tone of voice operations
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	toneOfVoiceSchema,
	exampleMessageSchema,
	toneOfVoiceWithExamplesSchema,
	exampleMessageContentSchema,
	generateToneResponseSchema,
} from '../../../lib/shared/validators/tone_of_voice';

export * from '../common/validators';
export * from '../../../lib/shared/validators/tone_of_voice';

export const toneOfVoiceValidator = zodToConvex(toneOfVoiceSchema);
export const exampleMessageValidator = zodToConvex(exampleMessageSchema);
export const toneOfVoiceWithExamplesValidator = zodToConvex(toneOfVoiceWithExamplesSchema);
export const exampleMessageContentValidator = zodToConvex(exampleMessageContentSchema);
export const generateToneResponseValidator = zodToConvex(generateToneResponseSchema);
