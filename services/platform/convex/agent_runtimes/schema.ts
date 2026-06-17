import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * External agent runtimes (the `tale-daemon` fleet): one row per
 * (daemonId, adapterType) pair an organization has registered. The daemon
 * generates a stable `daemonId` at setup and advertises which coding-agent
 * CLIs it can run (with version + detected capabilities); LOCAL WORKSPACE
 * PATHS NEVER LEAVE THE MACHINE — only the daemon-chosen `workspaceKeys`
 * are advertised here.
 *
 * Liveness is DERIVED from `lastHeartbeatAt` (no status field to drift):
 * a daemon heartbeats every 15s while runs are active and on every claim
 * poll otherwise, so readers treat >45s as degraded and >90s as offline.
 */

export const runtimeCapabilitiesValidator = v.object({
  jsonOutput: v.boolean(),
  sessionResume: v.boolean(),
  costReporting: v.boolean(),
  mcp: v.boolean(),
});

export const agentRuntimesTable = defineTable({
  organizationId: v.string(),
  daemonId: v.string(),
  adapterType: v.string(),
  /** Friendly machine/workspace label chosen at `tale daemon setup`. */
  name: v.optional(v.string()),
  /** Adapter CLI version from `detect()` — feature gates key off this. */
  version: v.optional(v.string()),
  capabilities: v.optional(runtimeCapabilitiesValidator),
  /** Advertised workspace keys (daemon-local key→path map stays local). */
  workspaceKeys: v.optional(v.array(v.string())),
  /** Better Auth userId that owns the daemon's API key. */
  createdBy: v.string(),
  registeredAt: v.number(),
  lastHeartbeatAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_daemon', ['organizationId', 'daemonId'])
  .index('by_org_daemon_adapter', [
    'organizationId',
    'daemonId',
    'adapterType',
  ]);

/** Heartbeat-age thresholds for the derived status (ms). */
export const RUNTIME_DEGRADED_AFTER_MS = 45_000;
export const RUNTIME_OFFLINE_AFTER_MS = 90_000;
