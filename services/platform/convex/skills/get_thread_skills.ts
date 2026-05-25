'use node';

/**
 * Returns the skills bound to whichever agent owns a given thread, with
 * enough info (name + description) for the chat-header chip to render
 * its popover. Used by `SkillsHeaderChip` in the chat header.
 *
 * Empty array when:
 *   - the thread has no agentSlug recorded, or
 *   - the agent has no skillBindings, or
 *   - reading any of the bound skills fails (logged as dangling).
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { resolveSkillsDir, readSkillMd, validateSkillSlug } from './file_utils';

interface ThreadMetadataLike {
  agentSlug?: string;
}

export const getThreadAgentSkills = action({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
  },
  returns: v.object({
    agentSlug: v.optional(v.string()),
    skills: v.array(
      v.object({
        slug: v.string(),
        description: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    // Single membership check up front — earlier this file called
    // `requireOrgMembershipById` twice (once to gate, once to pull
    // `orgSlug`), so every chat-page mount paid two Better Auth
    // roundtrips when the chip refreshes.
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    let agentSlug: string | undefined;
    try {
      const meta = (await ctx.runQuery(
        internal.threads.internal_queries.getThreadMetadata,
        {
          threadId: args.threadId,
          callerOrgId: args.organizationId,
        },
      )) as ThreadMetadataLike | null;
      agentSlug = meta?.agentSlug;
    } catch (err) {
      console.warn('[skills.get_thread_skills] thread lookup failed:', err);
    }
    if (!agentSlug) return { skills: [] };

    let skillBindings: string[] = [];
    try {
      const agentResult = (await ctx.runAction(
        internal.agents.file_actions.readAgentForChat,
        {
          organizationId: args.organizationId,
          agentName: agentSlug,
        },
      )) as { ok: boolean; config?: { skillBindings?: string[] } } | null;
      if (
        agentResult &&
        agentResult.ok &&
        Array.isArray(agentResult.config?.skillBindings)
      ) {
        skillBindings = agentResult.config.skillBindings.filter(
          (s) => typeof s === 'string' && validateSkillSlug(s),
        );
      }
    } catch (err) {
      console.warn('[skills.get_thread_skills] agent lookup failed:', err);
    }
    if (skillBindings.length === 0) return { agentSlug, skills: [] };

    // `resolveSkillsDir` re-validates the slug shape, so a malformed
    // value would throw here — kept as a defensive no-op even though
    // `readSkillMd` does the same check.
    resolveSkillsDir(orgSlug);

    const skills = await Promise.all(
      skillBindings.map(async (slug) => {
        const r = await readSkillMd(orgSlug, slug);
        if (!r.ok) return null;
        return { slug, description: r.meta.description };
      }),
    );
    return {
      agentSlug,
      skills: skills.filter(
        (s): s is { slug: string; description: string } => s !== null,
      ),
    };
  },
});
