'use node';

/**
 * Resolve an agent's config directly from the filesystem (no separate
 * resolveAgentConfig action hop). Returns the serializable config + the raw
 * supportedModels list so callers can apply governance/model-access overrides
 * with the same supportedModels gate the explicit-modelId path uses.
 *
 * Pure helper (no Convex function registration) — bundled into the `'use node'`
 * action that calls it (`agents/chat_turn_generate.ts`).
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { readJsonFile } from '../lib/file_io';
import { applyModelOverride, toSerializableConfig } from './config';
import {
  type AgentJsonConfig,
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
} from './file_utils';
import { resolveAgentPath } from './internal_actions';
import type { KnowledgeFile } from './schema';

export interface InlineConfigResult {
  config: SerializableAgentConfig;
  supportedModels: string[];
}

export async function resolveAgentConfigInline(
  ctx: ActionCtx,
  args: {
    orgSlug: string;
    agentSlug: string;
    organizationId: string;
    modelId?: string;
  },
): Promise<InlineConfigResult & { orgLocale: string }> {
  // Locate the backing file through the folder-aware index (chat/, workforce/,
  // github/, …); the flat `<slug>.json` fallback covers system agents and any
  // file written before the 60s index cache refreshed. Without this, every
  // foldered agent failed config load with "Agent not found".
  const filePath = await resolveAgentPath(args.orgSlug, args.agentSlug);

  // Parallelize JSON read, binding lookup, and org-locale lookup to preserve
  // the TTFT savings the inlined path was designed for.
  const [result, binding, orgLocale] = await Promise.all([
    readJsonFile<AgentJsonConfig>(
      filePath,
      MAX_FILE_SIZE_BYTES,
      parseAgentJson,
    ),
    ctx.runQuery(internal.agents.internal_queries.getBindingByAgent, {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
    }),
    ctx.runQuery(
      internal.organizations.internal_queries.getOrganizationDefaultLocale,
      { organizationId: args.organizationId },
    ),
  ]);
  if (!result.ok) {
    throw new Error(`Agent not found: ${args.agentSlug} — ${result.message}`);
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- binding shape guaranteed by getBindingByAgent query; returns v.any()
  const typedBinding = binding as {
    teamId?: string;
    sharedWithTeamIds?: string[];
    knowledgeFiles?: KnowledgeFile[];
  } | null;

  const config = toSerializableConfig(
    args.agentSlug,
    result.data,
    typedBinding
      ? {
          teamId: typedBinding.teamId ?? undefined,
          sharedWithTeamIds: typedBinding.sharedWithTeamIds ?? undefined,
          knowledgeFiles: typedBinding.knowledgeFiles ?? undefined,
        }
      : undefined,
    orgLocale,
  );

  if (args.modelId) {
    applyModelOverride(config, args.modelId, result.data.supportedModels);
  }

  return { config, supportedModels: result.data.supportedModels, orgLocale };
}
