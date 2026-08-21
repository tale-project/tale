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
  // Agent connector dispatch (in-sandbox MCP bridge → /api/connectors/execute).
  // Per-session token bucket — the dispatch is otherwise unmetered.
  'connectors:dispatch': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 80,
    shards: 4,
  },
  // Workspace-tool dispatch (in-sandbox MCP bridge → /api/tools/execute).
  // Same posture as connectors:dispatch — per-session token bucket on an
  // otherwise-unmetered surface.
  'tools:dispatch': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 80,
    shards: 4,
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
  // TIER 3.55: Knowledge entries (Token Bucket)
  // Bounds storage + RAG-pipeline churn from knowledge-entry writes.
  // ============================================
  // Agent-initiated knowledge_write approvals, keyed by org. Same shape as
  // prompt:create: 20-burst headroom, refilling at 10/min. Each approved
  // write stores a blob and triggers a RAG (re)index, so the bound matters.
  'knowledge:write': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
  // Manual create/update/delete from the Knowledge entries tab, keyed by org.
  'knowledge:mutate': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },

  // ============================================
  // TIER 3.6: Projects (Token Bucket)
  // Bounds storage churn from scripted project creation/duplication and
  // caps blast radius of cascade deletes (which touch every doc + thread).
  // ============================================
  'project:create': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
    shards: 4,
  },
  // Lower than create: cascade delete is destructive and expensive. Allows
  // a small burst for cleanup workflows but prevents a runaway loop.
  'project:delete-cascade': {
    kind: 'token bucket',
    rate: 5,
    period: MINUTE,
    capacity: 8,
    shards: 4,
  },

  // ============================================
  // TIER 3.7: Tasks (Token Bucket)
  // Bounds storage churn from scripted/agent task creation and comment spam.
  // Higher than project:create — tasks are lighter and created more often
  // (incl. by agents picking up and decomposing work).
  // ============================================
  'task:create': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 90,
    shards: 4,
  },
  'task:comment': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 90,
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
  // Per-IP throttle on the TTS audio-serve HTTP route. Mirrors the
  // `security:storage-access` shape since the cost shape is identical: an
  // authenticated user could hammer `/api/tts-audio?chunkId=…` to force
  // unbounded Convex storage reads on rows they're already entitled to
  // see. Cost-only (no data leak — the route already gates on org
  // membership) so the limit is set marginally higher than storage.
  //
  // Token-bucket (not fixed window) so a long auto-played message with
  // many chunks doesn't slam into a minute-boundary 429 cliff mid-
  // playback on a NAT/office IP. Capacity = 2× rate gives one bursty
  // ~200-chunk replay headroom without inviting steady-state abuse —
  // sustained traffic still settles at 120/min.
  'security:tts-audio-fetch': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  'security:image-proxy': {
    kind: 'fixed window',
    rate: 200,
    period: MINUTE,
  },
  // Per-IP throttle on the SSE-auth handshake route. Same shape as
  // `security:tts-audio-fetch` — anonymous flooding here forces a
  // Better Auth session-table read per request, so cost protection
  // matters more than data protection (the route 401s on no-session).
  // Token bucket so a freshly-logged-in user reconnecting across
  // multiple browser tabs doesn't hit a 429 cliff.
  'security:sse-auth': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  // Per-IP throttle on the read-only sandbox workspace file download route
  // (`/api/sandbox/workspace_file`). Same shape/rationale as
  // `security:tts-audio-fetch`: anonymous flooding forces a Better Auth
  // session read per request, and an authenticated browser could otherwise
  // hammer spawner file reads on a workspace it's already entitled to (cost,
  // not data — the route gates on canAccessThread). Token bucket so a file
  // browser issuing several quick reads doesn't hit a minute-boundary cliff.
  'security:workspace-file': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
  },
  // Per-IP throttle on the live-browser screencast auth oracle
  // (`/api/sandbox/screencast-auth`), the cookie→org gate the browser hits
  // before each VNC WebSocket upgrade. Same shape/rationale as
  // `security:sse-auth`: anonymous probing forces a Better Auth session read
  // per request; a real viewer reconnecting (network blips, pane re-open across
  // tabs) issues a small burst, so a token bucket avoids a minute-boundary cliff.
  'security:screencast-auth': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
  },
  'security:login-ip': {
    kind: 'fixed window',
    rate: 30,
    period: MINUTE,
  },
  // Per-IP throttle on FAILED WebDAV Basic-auth attempts. Charged ONLY on
  // a missing/mismatched credential (never on success), so a legitimate
  // Finder/rclone mount that fires many authenticated requests never
  // depletes it. Keyed by client IP (X-Forwarded-For), so an attacker is
  // throttled by their own source and cannot lock a victim org out — the
  // failure mode of the previous per-org design. Token bucket gives a
  // small retry burst; steady-state probing settles at 20/min/IP.
  'webdav:auth-fail-ip': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // Per-org backstop on failed WebDAV auth — bounds distributed probing
  // from many IPs against a known org slug. Set high so it never trips on
  // legitimate traffic (successful auths are not charged); it exists to
  // starve a botnet, not real clients.
  'webdav:auth-fail-org': {
    kind: 'token bucket',
    rate: 300,
    period: MINUTE,
    capacity: 600,
  },
  // Per-org cap on app-password minting. Each row is a HTTP-Basic credential
  // with PAT-equivalent reach; a runaway create loop (compromised admin
  // script) could bloat the org and pollute the prefix-index search space.
  // App-passwords are minted once per device — 20/hour/org is generous.
  'webdav:app-password-create': {
    kind: 'fixed window',
    rate: 20,
    period: HOUR,
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
  // Inbound Slack Events API endpoint backstop. Used two ways as independent
  // buckets (distinct key prefixes): keyed by Slack team_id for SIGNED traffic
  // (per-workspace flood backstop — on overflow the handler ACKs 200 and drops,
  // never 429, since a non-2xx counts toward Slack's endpoint auto-disable),
  // and keyed by client IP for FORGED/unsigned requests (401, or 429 under
  // flood). Signature verification authenticates signed traffic, so it is never
  // 429'd. Intentionally generous — a flood backstop, not a per-user limit.
  'connector:slack-events': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 240,
    // Shard the bucket (rate/capacity split across shards, aggregate unchanged
    // at 240 / 120-per-min) so concurrent same-key requests — a busy workspace's
    // signed events keyed by team_id, or a forged flood keyed by IP — spread
    // their writes across rows instead of serializing on one and tripping OCC
    // write-conflicts. Mirrors notify:slack.
    shards: 4,
  },
  // Per-org backstop on OUTBOUND system-notification posts to Slack
  // (notifications/notify_slack). Bounds a workflow-event burst from flooding
  // Slack and tripping Slack's own per-app limits. Token bucket gives a 60-burst
  // headroom for a batch of near-simultaneous alerts, settling at 30/min/org.
  'notify:slack': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 60,
    shards: 4,
  },
  'openai:chat': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 50,
  },
  // Tighter than openai:chat — image generation is materially more expensive
  // per call than a chat completion.
  'openai:images': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 15,
  },
  // Looser than openai:chat — listing models is cheap and frequently polled
  // by clients on startup.
  'openai:models': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
  },
  'rest:api': {
    kind: 'token bucket',
    rate: 120,
    period: MINUTE,
    capacity: 200,
  },
  // Tighter than rest:api — the two REST endpoints that START work rather than
  // read it (an automation run, a chat turn) each cost a model call or a whole
  // durable execution, so they get their own, much smaller budget. Same
  // reasoning as openai:images sitting below openai:chat.
  'rest:execute': {
    kind: 'token bucket',
    rate: 20,
    period: MINUTE,
    capacity: 40,
  },
  // The project-file upload/bind lane: one logical upload is several calls
  // (grant, upload, bind), so it sits above rest:api. REST buckets are
  // IP-keyed pre-auth — a NAT'd worker fleet shares one bucket, so this is
  // a fleet budget, not a per-worker one.
  'rest:upload': {
    kind: 'token bucket',
    rate: 240,
    period: MINUTE,
    capacity: 300,
  },
  // External agent runtimes (tale-daemon). Per-IP buckets; a hot daemon
  // polls claim at ~3s (20/min) and heartbeats at 15s while running.
  'runtime:register': {
    kind: 'fixed window',
    rate: 5,
    period: MINUTE,
  },
  'runtime:claim': {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 40,
  },
  'runtime:heartbeat': {
    kind: 'token bucket',
    rate: 10,
    period: MINUTE,
    capacity: 20,
  },
  'runtime:events': {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 120,
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
  // Per-org opportunistic self-heal: the agent-liveness gate schedules the
  // autoInstall sweep when it finds a never-provisioned org at run admission.
  // Caps it to one schedule per org per few minutes so concurrent admissions in
  // a fresh org collapse to a single provision. Token-bucket (not fixed-window)
  // for the same minute-boundary reason as the cleanup tiers above.
  'provision:autoheal': {
    kind: 'token bucket',
    rate: 1,
    period: 5 * MINUTE,
    capacity: 1,
  },
  // Lazy cleanup of expired slackEventDedup rows. Gated from claimSlackEvent so
  // a busy workspace sweeps at most once per hour. Token-bucket (not
  // fixed-window) for the same minute-boundary reason as cleanup:tts.
  'cleanup:slack-dedup': {
    kind: 'token bucket',
    rate: 1,
    period: HOUR,
    capacity: 1,
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
  // Per-user gate on `getCapability` action. The personalization page
  // calls it on mount; a malicious script could probe arbitrary
  // organizationIds and fill the *target* org's audit log via
  // `logCapabilityProbeDenied`. Cap at 12/min/user (legitimate UI usage
  // is 1-2 calls/hour); 20 capacity absorbs a tab-multi-mount burst.
  'tts:capability-probe:user': {
    kind: 'token bucket',
    rate: 12,
    period: MINUTE,
    capacity: 20,
    shards: 4,
  },
});

export type RateLimitName = Parameters<typeof rateLimiter.limit>[1];
