/**
 * Centralized Action Cache Configuration
 *
 * This module defines all cache instances for expensive action results.
 * Each cache has an action reference, name (for versioning), and optional TTL.
 */

import { ActionCache } from '@convex-dev/action-cache';
import type { FunctionReference } from 'convex/server';
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
// AI Operation Caches
// ============================================

/**
 * Cache for AI text improvement results.
 * Same input produces same output (deterministic).
 * 24-hour TTL for daily refresh.
 */
export const improveMessageCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.actions.improve_message.improveMessageUncached,
  name: `improve_message_${CACHE_VERSION}`,
  ttl: TTL.ONE_DAY,
});

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
// Web Crawling Caches
// ============================================

/**
 * Cache for search engine results.
 * Results change frequently, 30-minute TTL.
 */
export const searchResultsCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.agent_tools.crawler.internal_actions.fetchSearXNGResultsUncached,
  name: `search_results_${CACHE_VERSION}`,
  ttl: TTL.THIRTY_MIN,
});

// ============================================
// Organization Configuration Caches
// ============================================

/**
 * Cache for tone of voice generation results.
 * Stable until example messages change.
 * 24-hour TTL for daily refresh.
 */
export const toneOfVoiceCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.tone_of_voice.actions.generate_tone_of_voice.generateToneOfVoiceUncached,
  name: `tone_of_voice_${CACHE_VERSION}`,
  ttl: TTL.ONE_DAY,
});
