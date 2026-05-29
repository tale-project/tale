import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-user app-passwords for HTTP Basic auth on the /dav/* WebDAV endpoint.
// Generated through settings UI, shown once, hashed via HMAC-SHA256 keyed
// by WEBDAV_APP_PASSWORD_HMAC_KEY (deployment env). Users may hold many
// (one per client device); revocation is soft via revokedAt.
//
// Why HMAC (not bcrypt/argon2): the password itself is a 32-char random
// secret we generate — not a user-chosen weak password. HMAC is fine for
// verifying knowledge of a high-entropy secret and works in the Convex V8
// isolate without 'use node'. Same model as GitHub PATs / Vercel tokens.
//
// Auth check: see findCandidatesByPrefix in app_password_queries.ts. The
// query narrows by passwordPrefix (first 4 plaintext chars, stored
// alongside the hash for indexed lookup) — Hono then HMAC-compares the
// full password against passwordHashed in constant time. Returning the
// prefix in the UI keeps the rows identifiable post-create without ever
// showing the secret again.
export const webdavAppPasswordsTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  label: v.string(),
  passwordHashed: v.string(),
  passwordPrefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index('by_organization_user', ['organizationId', 'userId'])
  // Lookup by prefix narrows bcrypt to ~1 candidate per request without
  // exposing the full hash. Same shape Better Auth uses for its API keys.
  .index('by_organization_prefix', ['organizationId', 'passwordPrefix']);

// WebDAV Class 2 locks. RFC 4918 §6. Token format on the wire is
// "opaquelocktoken:<uuid>" — we store the uuid alone in `lockToken` and
// format on emit.
//
// expiresAt is enforced lazily on read (see lock_queries.findLockForPath):
// stale rows trigger a delete-soon mutation and the query returns null. No
// cron — matches feedback_lazy_cleanup_over_cron.
//
// resourcePath is the canonical wire path WITHOUT the /dav/<orgSlug>
// prefix — e.g. "/documents/folder/file.docx". Org scoping lives in
// organizationId. This keeps lock identity stable if we ever rename the
// outer scheme.
export const webdavLocksTable = defineTable({
  organizationId: v.string(),
  resourcePath: v.string(),
  lockToken: v.string(),
  ownerXml: v.string(),
  depth: v.union(v.literal('0'), v.literal('infinity')),
  scope: v.union(v.literal('exclusive'), v.literal('shared')),
  ownerUserId: v.string(),
  // Foreign key to the app-password used to create this lock. When the
  // app-password is revoked we hard-delete the user's locks created
  // through it — covers the "client crashed mid-edit, lock outlives
  // session" recovery path in the plan.
  appPasswordId: v.id('webdavAppPasswords'),
  expiresAt: v.number(),
})
  .index('by_organization_resource', ['organizationId', 'resourcePath'])
  .index('by_token', ['lockToken'])
  .index('by_appPasswordId', ['appPasswordId'])
  .index('by_expiresAt', ['expiresAt']);
