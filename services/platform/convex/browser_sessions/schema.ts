import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * A deployment-wide pool of pre-warmed BROWSER SESSIONS — the cookie/visitor
 * state of a real browser that has already cleared a site's bot wall (e.g.
 * YouTube's "confirm you're not a bot", a Cloudflare challenge). A human may
 * solve the challenge once during warming; the resulting session is then reused
 * by any server-side reach-out (yt-dlp video ingest, the agent web-fetch tool,
 * the crawler) so requests from the deployment's egress look like a returning
 * visitor instead of a fresh bot.
 *
 * Sessions are **per-org AND domain-scoped**: a session's cookies only help the
 * host they were warmed for, so consumers claim by `(organizationId, domain)`.
 * Rotation is least-recently-used, health is tracked, and cookies are encrypted
 * at rest (`encryptString`, the JWE box used for OAuth credentials) — the raw
 * jar is never persisted in plaintext or returned to a client.
 *
 * TENANT-ISOLATION INVARIANT (do not weaken): browser sessions are NEVER shared
 * across organizations. A warmed session carries one org's account/guest cookies
 * — reusing it for another org would leak that identity, so every claim/import
 * is scoped to `organizationId` and a claim only ever returns THAT org's
 * sessions. Nothing about an org's egress state may be shared with another org.
 */
export const browserSessionsTable = defineTable({
  // Owning organization. Scoping key: a claim only returns this org's sessions,
  // never another tenant's. Always set on insert (see `insertBrowserSession`);
  // optional in the schema only so the type stays additive.
  organizationId: v.optional(v.string()),
  // Registrable host this session is warmed for (e.g. `youtube.com`). Consumers
  // claim sessions matching the host they're about to reach.
  domain: v.string(),
  // encryptString(<Netscape cookies.txt jar>). Decrypted only inside the
  // reaching action, written to a scratch dir / applied as a Cookie header,
  // never returned to a client.
  cookiesEncrypted: v.string(),
  // The browser User-Agent that produced the session, so consumers can keep the
  // UA coherent with the cookies (a mismatched UA is itself a bot signal).
  userAgent: v.optional(v.string()),
  // Site-specific extras. For YouTube: the innertube visitor_data and a PO
  // token captured alongside the cookies.
  visitorData: v.optional(v.string()),
  poToken: v.optional(v.string()),
  // Operator-friendly label for the sessions list (e.g. "yt-burner-1").
  label: v.optional(v.string()),
  status: v.union(
    v.literal('healthy'),
    // Transiently rate-limited / soft-failed; skipped until it recovers (a
    // quiet period) or ages out. Distinct from `expired` so a blip doesn't
    // discard a session someone spent effort warming.
    v.literal('cooling'),
    v.literal('expired'),
  ),
  // `imported` (operator pasted a warmed jar) or `warmed` (an automated warmer
  // produced it — reserved for future use).
  source: v.union(v.literal('imported'), v.literal('warmed')),
  // Unix ms after which the session is treated as expired regardless of health.
  expiresAt: v.number(),
  // Unix ms of the last claim (LRU rotation key).
  lastUsedAt: v.optional(v.number()),
  // Consecutive bot-wall/forbidden/rate-limit failures; flips to cooling and
  // then expired past a threshold so a burned session stops being handed out.
  failureCount: v.optional(v.number()),
  // Better Auth user id of the operator who imported it (audit only).
  createdBy: v.optional(v.string()),
})
  // Cron sweep visits live rows by status across all domains.
  .index('by_status', ['status'])
  // Per-org, domain-scoped LRU claim: seek `(organizationId, domain,
  // status='healthy')` ordered by `lastUsedAt` ascending so the least-recently-
  // used matching session for THAT org wins. Org-first so a claim can never
  // reach another tenant's sessions.
  .index('by_org_and_domain_and_status_and_lastUsedAt', [
    'organizationId',
    'domain',
    'status',
    'lastUsedAt',
  ]);
