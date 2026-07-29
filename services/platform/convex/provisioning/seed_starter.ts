/**
 * Starter content seeder — gives a fresh org something to look at: a
 * "Getting started" project and a few example tasks (left unassigned so the
 * triage workflow can route them to always-available agents — never to a
 * GitHub-gated agent). Scheduled from `auth.ts:afterCreateOrganization` after
 * the agent provisioner.
 *
 * Idempotent: skips entirely if the org already has any project, so a repeated
 * schedule never duplicates the example content. Best-effort — every step is
 * wrapped so a single failure never blocks the rest (and never the org).
 */

import { v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction } from '../_generated/server';

// Seeded copy must not tokenize as a real mention: `@mention` parses as the
// (nonexistent) agent handle "mention" under the permissive 'all' agent mode
// and fires phantom `task.mentioned` events on every fresh org — write "@"
// followed by a space instead (see MENTION_RE in `tasks/mentions.ts`).
const EXAMPLE_TASKS = [
  {
    title: 'Welcome — meet your assistant',
    description:
      'Your workspace comes with a general-purpose chat Assistant ready to go. Open the Agents page to browse the full catalog and install the agents you want. Then mention any installed agent with @ in a task to put them to work.',
    priority: 'p2' as const,
  },
  {
    title: 'Draft a one-page company overview',
    description:
      'A good first task to delegate: mention your Assistant with @ and ask it to draft a concise overview you can edit — or install the Content Writer agent from the Agents page and assign it there.',
    priority: 'p3' as const,
  },
  {
    title: 'Connect an connector',
    description:
      'Connect GitHub, Gmail, or another connector from Settings → Connectors, then install agents like the Software Developer or PR Reviewer from the Agents page to work your repos and inbox.',
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

    let projectId: Id<'projects'>;
    try {
      const created = await ctx.runMutation(
        internal.tasks.internal_mutations.agentCreateProject,
        {
          organizationId: args.organizationId,
          actorId: 'system',
          name: 'Getting started',
          description:
            'A starter project to explore tasks and your agents. Feel free to rename or delete it.',
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

    return null;
  },
});
