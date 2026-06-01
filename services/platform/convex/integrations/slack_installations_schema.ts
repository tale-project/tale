import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Routing table for the shared Slack App.
 *
 * The platform runs ONE Slack App (one client_id / client_secret / signing
 * secret). Each org installs it into their workspace via the standard
 * integration OAuth2 flow and gets its own bot token stored per-org in
 * `integrationCredentials` (slug='slack'). Inbound Slack events all arrive at a
 * single Request URL, so they must be routed back to the installing org by the
 * Slack `team_id` carried in the event envelope — this table is that lookup.
 *
 * Holds only routing/identity fields; the bot token itself lives encrypted in
 * `integrationCredentials`. `credentialId` back-references the owning credential
 * row so a disconnect can cascade-delete the routing entry.
 */
export const slackInstallationsTable = defineTable({
  teamId: v.string(),
  teamName: v.optional(v.string()),
  // Enterprise-grid id; absent for standalone workspaces. Stored for a future
  // enterprise-wide routing fallback (see plan); routing keys on teamId today.
  enterpriseId: v.optional(v.string()),
  organizationId: v.string(),
  slug: v.string(),
  // The bot's own Slack user id (Uxxxx) — used to drop the bot's own messages
  // in the inbound pipeline (self-message loop prevention).
  botUserId: v.optional(v.string()),
  appId: v.optional(v.string()),
  credentialId: v.id('integrationCredentials'),
  installedAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_team', ['teamId'])
  .index('by_organizationId', ['organizationId'])
  .index('by_credentialId', ['credentialId']);
