import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Project-scoped secrets, encrypted at rest with AES-256-GCM via
 * `lib/secret_box.ts` (same primitive as `governanceSecretsTable`). The value
 * NEVER appears in the audit log or in any query response — `listProjectSecrets`
 * returns metadata only, and plaintext is resolved exclusively inside a
 * `'use node'` action for injection into a runtime dispatch payload.
 */
export const projectSecretsTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  name: v.string(),
  description: v.optional(v.string()),
  ciphertext: v.string(),
  nonce: v.string(),
  authTag: v.string(),
  keyFingerprint: v.string(),
  createdBy: v.string(),
  updatedBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_project', ['organizationId', 'projectId'])
  .index('by_project_name', ['organizationId', 'projectId', 'name']);

/**
 * Append-only ledger of agent access to project secrets. Records metadata
 * reads (via the `secret_read` tool) and injected-dispatch uses; NEVER stores
 * the secret value. Backs governance/audit of "agent X touched secret Y".
 */
export const agentSecretAccessTable = defineTable({
  organizationId: v.string(),
  projectId: v.id('projects'),
  secretName: v.string(),
  agentSlug: v.string(),
  threadId: v.optional(v.string()),
  userId: v.optional(v.string()),
  accessType: v.union(
    v.literal('metadata_read'),
    v.literal('injected_dispatch'),
  ),
  decision: v.union(
    v.literal('approved'),
    v.literal('denied'),
    v.literal('auto'),
  ),
  reason: v.optional(v.string()),
  createdAt: v.number(),
})
  .index('by_org_project', ['organizationId', 'projectId'])
  .index('by_org_agent', ['organizationId', 'agentSlug'])
  .index('by_thread', ['organizationId', 'threadId']);
