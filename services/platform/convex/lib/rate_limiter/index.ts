/**
 * Centralized Rate Limiter Configuration
 *
 * This module defines all rate limit rules for the platform.
 * Rules are organized by category and priority tier.
 */

import { RateLimiter, MINUTE, HOUR, DAY } from '@convex-dev/rate-limiter';

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
  // TIER 3: File & Folder Operations (Fixed Window)
  // Resource-intensive operations with predictable limits
  // ============================================
  'folder:mutate': {
    kind: 'fixed window',
    rate: 60,
    period: MINUTE,
  },
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
  // TIER 3.5: Prompt Library (Token Bucket)
  // Bounds storage churn from scripted prompt mutations
  // ============================================
  // Prevents an authenticated org member from looping createPrompt to bloat
  // the org. Each prompt row can be ~218 KiB at the configured caps, so the
  // bound matters. Token bucket gives a 20-burst headroom for legitimate
  // batch imports, refilling at 10/min.
  'prompt:create': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
  // Same shape as prompt:create — bounds storage churn from scripted edits
  // that could FIFO-evict the version history (12 versions) within seconds.
  'prompt:update': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
  'prompt:restore': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
  // Bounds destructive churn from scripted delete loops; also caps audit-log
  // spam from a malicious member walking the org's prompts.
  'prompt:delete': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
  // Caps counter-spam on a popular global/team prompt; not security-critical
  // but prevents trivial leaderboard manipulation.
  'prompt:incrementUsage': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
    shards: 4,
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
  'security:image-proxy': {
    kind: 'fixed window',
    rate: 200,
    period: MINUTE,
  },
  'security:login-ip': {
    kind: 'fixed window',
    rate: 30,
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
  'workflow:run': {
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
  'agent:webhook': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 50,
  },
  'openai:chat': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 50,
  },
  'rest:api': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
  },
  'agent:document-list': {
    kind: 'fixed window',
    rate: 30,
    period: MINUTE,
  },
  'email:send': {
    kind: 'token bucket',
    rate: 100,
    period: HOUR,
    capacity: 120,
  },

  // ============================================
  // TIER 6: Maintenance (Fixed Window)
  // Background cleanup and retention tasks
  // ============================================
  'cleanup:retention': {
    kind: 'fixed window',
    rate: 1,
    period: HOUR,
  },
  // Per-(user, org) lazy cleanup of personalization memory rows. Gates
  // opportunistic GC so it runs at most once per hour per user-org tuple,
  // independent of how many mutations they fire in that window.
  'cleanup:personalization': {
    kind: 'fixed window',
    rate: 1,
    period: HOUR,
  },
  // Per-thread lazy cleanup of TTS audio chunks. Gates opportunistic GC
  // scheduled from `markChunkReadyAndRecordUsage` (the write path) on the
  // first chunk of each message so a busy thread schedules at most one
  // sweep per hour. Cross-thread orphans are reaped by the daily
  // `gcOrgTtsChunks` cron — see `crons.ts`.
  //
  // Token-bucket (not fixed-window): under fixed-window, a sweep at
  // 14:59:59 and another at 15:00:00 both pass the gate. Token-bucket
  // with rate=1/hour and capacity=1 means a fresh token only arrives an
  // hour after the previous one is consumed.
  'cleanup:tts': {
    kind: 'token bucket',
    rate: 1,
    period: HOUR,
    capacity: 1,
  },

  // ============================================
  // TIER 8: TTS (Token Bucket)
  // Voice-output synthesis bills per character to upstream provider;
  // keep abuse bounded even for authenticated users.
  // ============================================
  // Per-user bucket: realistic streaming generates ~5-15 chunks per minute;
  // 60 capacity covers a multi-message session burst, refills at 40/min.
  // Shards aligned with the rest of the platform (≤4): the OCC contention
  // that previously motivated 16 is handled differently now — the action
  // catches `OptimisticConcurrencyControlFailure` and surfaces `CONTENTION`
  // (a distinct error code from `RATE_LIMITED`), and the client backs off
  // with the short OCC-jitter delay instead of the quota-recovery delay.
  // See `synthesize.ts::errorCodeFromCaught` for the mapping.
  'tts:synthesize:user': {
    kind: 'token bucket',
    rate: 40,
    period: MINUTE,
    capacity: 60,
    shards: 4,
  },
  // Per-org bucket: cushions cross-tenant abuse where one user can't be
  // pinned. Higher rate than per-user since multiple legitimate members
  // share it.
  'tts:synthesize:org': {
    kind: 'token bucket',
    rate: 200,
    period: MINUTE,
    capacity: 400,
    shards: 4,
  },

  // ============================================
  // TIER 7: Governance (Fixed Window)
  // High-blast-radius admin actions
  // ============================================
  // Per-admin daily filing limit for GDPR Art 17 erasure requests.
  // Caps blast radius from a compromised admin credential / scripted
  // abuse / runaway approval-bot. Default: 5 requests/admin/day. Daily
  // limit is overridable per-org via `dsar_governance` policy (the org
  // policy sets the bucket consumption guard; this limiter is a
  // platform-level floor).
  'governance:dsar_request': {
    kind: 'fixed window',
    rate: 5,
    period: DAY,
  },
});

export type RateLimitName = Parameters<typeof rateLimiter.limit>[1];
