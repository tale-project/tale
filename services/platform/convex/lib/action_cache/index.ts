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
// File Processing Caches
// ============================================

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
// Changelog Cache
// ============================================

/**
 * Cache for the GitHub releases feed.
 * No args → single global cache key shared across all users.
 */
// Cached per-page so page 1 is shared across every user, and only users
// genuinely lagging behind cause a page-2/3 fetch. Reads the public web
// HTML at github.com/.../releases — no API rate limit, paginated via
// `?page=N`. 1h TTL keeps fetches infrequent.
export const githubReleasesPageCache: ActionCache<
  FunctionReference<'action', 'internal'>
> = new ActionCache(components.actionCache, {
  action: internal.changelog.internal_actions.fetchReleasesPageUncached,
  name: `github_releases_html_${CACHE_VERSION}`,
  ttl: TTL.ONE_HOUR,
});
