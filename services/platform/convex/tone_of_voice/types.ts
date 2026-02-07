/**
 * Type definitions for tone of voice operations
 */

import type { Infer } from 'convex/values';
import {
  exampleMessageContentValidator,
  exampleMessageValidator,
  generateToneResponseValidator,
  toneOfVoiceValidator,
  toneOfVoiceWithExamplesValidator,
} from './validators';

export type ToneOfVoice = Infer<typeof toneOfVoiceValidator>;
export type ExampleMessage = Infer<typeof exampleMessageValidator>;
export type ToneOfVoiceWithExamples = Infer<
  typeof toneOfVoiceWithExamplesValidator
>;
export type ExampleMessageContent = Infer<typeof exampleMessageContentValidator>;
export type GenerateToneResponse = Infer<typeof generateToneResponseValidator>;
