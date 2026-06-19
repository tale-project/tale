/**
 * Starter content seeder — gives a fresh org something to look at: a
 * "Getting started" project, a few example tasks (left unassigned so the
 * triage workflow can route them to always-available agents — never to a
 * GitHub-gated agent), and one example discussion that @mentions the default
 * assistant. Scheduled from `auth.ts:afterCreateOrganization` after the agent
 * provisioner.
 *
 * Idempotent: skips entirely if the org already has any project, so a repeated
 * schedule never duplicates the example content. Best-effort — every step is
 * wrapped so a single failure never blocks the rest (and never the org).
 */

import { v } from 'convex/values';

import { DEFAULT_CHAT_AGENT_SLUG } from '../../lib/shared/constants/agents';
import { internal } from '../_generated/api';
import { internalAction } from '../_generated/server';

const EXAMPLE_TASKS = [
  {
    title: 'Welcome — meet your AI workforce',
    description:
      'Your organization ships with a full company of AI agents (CEO, CTO, CMO, COO, CFO and their teams). Open the Agents page to see the org chart, then @mention any agent in a task or discussion to put them to work.',
    priority: 'p2' as const,
  },
  {
    title: 'Draft a one-page company overview',
    description:
      'A good first task to delegate: assign this to the Content Writer (or leave it for triage) to produce a concise overview you can edit.',
    priority: 'p3' as const,
  },
  {
    title: 'Connect an integration',
    description:
      'Connect GitHub, Gmail, or another integration from Settings → Integrations. Connecting GitHub unlocks the Software Developer, PR Reviewer, and Issue Triager agents automatically.',
    priority: 'p3' as const,
  },
];

export const seedStarterContent = internalAction({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const alreadySeeded = await ctx.runQuery(
      internal.projects.internal_queries.orgHasAnyProject,
      { organizationId: args.organizationId },
    );
    if (alreadySeeded) return null;

    let projectId;
    try {
      const created = await ctx.runMutation(
        internal.tasks.internal_mutations.agentCreateProject,
        {
          organizationId: args.organizationId,
          actorId: 'system',
          name: 'Getting started',
          description:
            'A starter project to explore tasks, discussions, and your AI workforce. Feel free to rename or delete it.',
          instructions:
            'This is an example project. Agents working here should be concise and welcoming, and explain what they did.',
        },
      );
      projectId = created.projectId;
    } catch (err) {
      console.error(
        '[seedStarterContent] failed to create starter project',
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    for (const task of EXAMPLE_TASKS) {
      try {
        await ctx.runMutation(
          internal.tasks.internal_mutations.agentCreateTask,
          {
            organizationId: args.organizationId,
            actorId: 'system',
            projectId,
            title: task.title,
            description: task.description,
            priority: task.priority,
          },
        );
      } catch (err) {
        console.warn(
          '[seedStarterContent] failed to create example task',
          err instanceof Error ? err.message : err,
        );
      }
    }

    try {
      await ctx.runMutation(
        internal.discussions.internal_mutations.agentOpenDiscussion,
        {
          organizationId: args.organizationId,
          actorId: 'system',
          projectId,
          title: 'How should we get started?',
          message: `Welcome! This is a discussion — a place to ask questions and make decisions with your team. @${DEFAULT_CHAT_AGENT_SLUG}, can you suggest three things a new team should do first?`,
          category: 'general',
        },
      );
    } catch (err) {
      console.warn(
        '[seedStarterContent] failed to open example discussion',
        err instanceof Error ? err.message : err,
      );
    }

    return null;
  },
});
