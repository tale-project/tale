/**
 * Internal queries for custom agents.
 *
 * Used by the partner agent system to load active published versions
 * of partner agents at runtime.
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { toId } from '../lib/type_cast_helpers';
import { toSerializableConfig } from './config';

export const getActivePartnerAgents = internalQuery({
  args: {
    rootVersionIds: v.array(v.string()),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const partners = [];

    for (const rootId of args.rootVersionIds) {
      const query = ctx.db
        .query('customAgents')
        .withIndex('by_root_status', (q) =>
          q
            .eq('rootVersionId', toId<'customAgents'>(rootId))
            .eq('status', 'active'),
        );

      for await (const agent of query) {
        if (agent.organizationId !== args.organizationId) continue;

        const agentConfig = toSerializableConfig(agent);

        const model =
          agent.modelPreset === 'advanced'
            ? (process.env.OPENAI_CODING_MODEL ??
              process.env.OPENAI_MODEL ??
              '')
            : agent.modelPreset === 'fast'
              ? (process.env.OPENAI_FAST_MODEL ??
                process.env.OPENAI_MODEL ??
                '')
              : (process.env.OPENAI_MODEL ?? '');

        partners.push({
          rootVersionId: rootId,
          name: agent.name,
          displayName: agent.displayName,
          description: agent.description ?? '',
          agentConfig,
          model,
          provider: 'openai',
          roleRestriction: agent.roleRestriction,
        });
        break;
      }
    }

    return partners;
  },
});
