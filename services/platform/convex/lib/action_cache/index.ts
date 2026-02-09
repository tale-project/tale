/**
 * Centralized Action Cache Configuration
 *
 * This module defines all cache instances for expensive action results.
 * Each cache has an action reference, name (for versioning), and optional TTL.
 */

import type { FunctionReference } from 'convex/server';

import { ActionCache } from '@convex-dev/action-cache';

import { components, internal } from '../../_generated/api';

// Version prefix for cache invalidation when logic changes
const CACHE_VERSION = 'v1';

// ============================================
// TTL Constants (in milliseconds)
// ============================================
export const TTL = {
  INDEFINITE: undefined,
  FIFTEEN_MIN: 15 * 60 * 1000,
  THIRTY_MIN: 30 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  SEVEN_DAYS: 7 * 24 * 60 * 60 * 1000,
} as const;

// ============================================
// File Processing Caches
// ============================================

/**
 * Cache for file parsing results.
 * File content is immutable per storage ID.
 */
export const parseFileCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.agent_tools.files.internal_actions.parseFileUncached,
  name: `parse_file_${CACHE_VERSION}`,
  ttl: TTL.INDEFINITE,
});

/**
 * Cache for image analysis results.
 * Same image + question produces same analysis.
 */
export const imageAnalysisCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.agent_tools.files.internal_actions.analyzeImageUncached,
  name: `image_analysis_${CACHE_VERSION}`,
  ttl: TTL.INDEFINITE,
});

// ============================================
// Organization Configuration Caches
// ============================================

/**
 * Cache for tone of voice generation results.
 * Stable until example messages change.
 * 24-hour TTL for daily refresh.
 */
// Note: The internal_actions module needs to be regenerated (run `npx convex dev`)

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex internal module reference
const toneOfVoiceModule = internal.tone_of_voice as unknown as {
  internal_actions: {
    generateToneOfVoiceUncached: FunctionReference<'action', 'internal'>;
  };
};

export const toneOfVoiceCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: toneOfVoiceModule.internal_actions.generateToneOfVoiceUncached,
  name: `tone_of_voice_${CACHE_VERSION}`,
  ttl: TTL.ONE_DAY,
});
