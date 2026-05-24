'use node';

/**
 * Scan all agents in an organization to find those bound to a given skill.
 * Surfaced by the delete-skill confirmation dialog so the user sees who
 * will be affected before pressing delete. Mirrors the pattern at
 * `integrations/find_related_automations.ts`.
 *
 * Read-only and side-effect-free — never mutates an agent JSON. Cascade
 * "unbind from all" is a separate explicit operation surfaced in the UI
 * (see Phase 6 in the plan).
 */

import { readdir } from 'node:fs/promises';

import { v } from 'convex/values';

import { action } from '../_generated/server';
import {
  MAX_FILE_SIZE_BYTES,
  agentNameFromFileName,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentsDir,
  validateAgentName,
  type AgentJsonConfig,
} from '../agents/file_utils';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { readJsonFile } from '../lib/file_io';

export const findAgentsBindingSkill = action({
  args: {
    organizationId: v.string(),
    skillSlug: v.string(),
  },
  returns: v.array(
    v.object({
      agentName: v.string(),
      displayName: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveAgentsDir(orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const agentNames = entries
      .filter((e) => e.endsWith('.json'))
      .map(agentNameFromFileName)
      .filter(validateAgentName);

    const matches: Array<{ agentName: string; displayName?: string }> = [];
    await Promise.all(
      agentNames.map(async (agentName) => {
        const filePath = resolveAgentFilePath(orgSlug, agentName);
        const result = await readJsonFile<AgentJsonConfig>(
          filePath,
          MAX_FILE_SIZE_BYTES,
          parseAgentJson,
        );
        if (!result.ok) return;
        const bindings = result.data.skillBindings ?? [];
        if (bindings.includes(args.skillSlug)) {
          const entry: { agentName: string; displayName?: string } = {
            agentName,
          };
          if (result.data.displayName) {
            entry.displayName = result.data.displayName;
          }
          matches.push(entry);
        }
      }),
    );
    matches.sort((a, b) => a.agentName.localeCompare(b.agentName));
    return matches;
  },
});
