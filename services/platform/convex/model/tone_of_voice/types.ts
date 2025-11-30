/**
 * Type definitions for tone of voice operations
 */

import { v } from 'convex/values';
import { Id } from '../../_generated/dataModel';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Tone of voice validator
 */
export const toneOfVoiceValidator = v.object({
  _id: v.id('toneOfVoice'),
  _creationTime: v.number(),
  organizationId: v.string(),
  generatedTone: v.optional(v.string()),
  lastUpdated: v.number(),
  metadata: v.optional(v.any()),
});

/**
 * Example message validator
 */
export const exampleMessageValidator = v.object({
  _id: v.id('exampleMessages'),
  _creationTime: v.number(),
  organizationId: v.string(),
  toneOfVoiceId: v.id('toneOfVoice'),
  content: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  metadata: v.optional(v.any()),
});

/**
 * Tone of voice with examples validator
 */
export const toneOfVoiceWithExamplesValidator = v.object({
  toneOfVoice: toneOfVoiceValidator,
  examples: v.array(exampleMessageValidator),
});

/**
 * Example message content validator (for AI processing)
 */
export const exampleMessageContentValidator = v.object({
  content: v.string(),
});

/**
 * Generate tone response validator
 */
export const generateToneResponseValidator = v.object({
  success: v.boolean(),
  tone: v.optional(v.string()),
  error: v.optional(v.string()),
});

// =============================================================================
// TYPESCRIPT TYPES
// =============================================================================

export interface ToneOfVoice {
  _id: Id<'toneOfVoice'>;
  _creationTime: number;
  organizationId: string;
  generatedTone?: string;
  lastUpdated: number;
  metadata?: unknown;
}

export interface ExampleMessage {
  _id: Id<'exampleMessages'>;
  _creationTime: number;
  organizationId: string;
  toneOfVoiceId: Id<'toneOfVoice'>;
  content: string;
  createdAt: number;
  updatedAt: number;
  metadata?: unknown;
}

export interface ToneOfVoiceWithExamples {
  toneOfVoice: ToneOfVoice;
  examples: Array<ExampleMessage>;
}

export interface ExampleMessageContent {
  content: string;
}

export interface GenerateToneResponse {
  success: boolean;
  tone?: string;
  error?: string;
}
