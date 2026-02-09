/**
 * Centralized Rate Limiter Configuration
 *
 * This module defines all rate limit rules for the platform.
 * Rules are organized by category and priority tier.
 */

import { RateLimiter, MINUTE, HOUR } from '@convex-dev/rate-limiter';

import { components } from '../../_generated/api';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // ============================================
  // TIER 1: AI Operations (Token Bucket - allows bursts)
  // High cost LLM calls that consume API credits
  // ============================================
  'ai:chat': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
    shards: 4,
  },
  'ai:improve': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 25,
  },
  'ai:workflow-assistant': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 30,
    shards: 4,
  },
  'ai:summarize': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },

  // ============================================
  // TIER 2: External API Calls (Token Bucket)
  // Third-party APIs with their own rate limits
  // ============================================
  'external:onedrive-list': {
    kind: 'token bucket',
    rate: 100,
    period: MINUTE,
    capacity: 120,
  },
  'external:onedrive-read': {
    kind: 'token bucket',
    rate: 50,
    period: MINUTE,
    capacity: 60,
  },
  'external:onedrive-search': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
  'external:email-test': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  'external:oauth-callback': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  'external:integration-test': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },

  // ============================================
  // TIER 3: File Operations (Fixed Window)
  // Resource-intensive operations with predictable limits
  // ============================================
  'file:upload': {
    kind: 'fixed window',
    rate: 50,
    period: MINUTE,
  },
  'file:rag-retry': {
    kind: 'fixed window',
    rate: 10,
    period: MINUTE,
  },
  'file:generate-document': {
    kind: 'fixed window',
    rate: 20,
    period: MINUTE,
  },
  'file:generate-pptx': {
    kind: 'fixed window',
    rate: 10,
    period: MINUTE,
  },
  'file:generate-docx': {
    kind: 'fixed window',
    rate: 10,
    period: MINUTE,
  },
  'file:generate-excel': {
    kind: 'fixed window',
    rate: 20,
    period: MINUTE,
  },

  // ============================================
  // TIER 4: Security (Fixed Window - strict)
  // Prevent brute-force and abuse
  // ============================================
  'security:storage-access': {
    kind: 'fixed window',
    rate: 100,
    period: MINUTE,
  },

  // ============================================
  // TIER 5: Workflow Operations (Token Bucket)
  // Workflow and email sending operations
  // ============================================
  'workflow:cancel': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 25,
  },
  'workflow:webhook': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 100,
  },
  'workflow:api': {
    kind: 'token bucket',
    rate: 100,
    period: MINUTE,
    capacity: 150,
  },
  'email:send': {
    kind: 'token bucket',
    rate: 100,
    period: HOUR,
    capacity: 120,
  },
});

export type RateLimitName = Parameters<typeof rateLimiter.limit>[1];
