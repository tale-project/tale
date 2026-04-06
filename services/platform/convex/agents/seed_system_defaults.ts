/**
 * System Default Agent Seeding (legacy stubs)
 *
 * System default agents are now JSON files baked into the Docker image
 * at /app/agents-builtin/ and seeded to AGENTS_DIR by the entrypoint.
 * These mutations are kept as no-ops since they're called from
 * organization creation flow.
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

export const seedSystemDefaultAgents = internalMutation({
  args: {
    organizationId: v.string(),
  },
  handler: async () => {
    // No-op: system default agents are JSON files seeded by Docker entrypoint.
  },
});

export const ensureSystemDefaults = internalMutation({
  args: {
    organizationId: v.string(),
  },
  handler: async () => {
    // No-op: system default agents are JSON files seeded by Docker entrypoint.
  },
});
