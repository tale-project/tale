import type { TaskHandover } from '../../../lib/chat/handover';
import { isRecord } from '../../../lib/utils/type-utils';
import { catalogString } from '../i18n/catalog';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';

/**
 * How the person talking hands work to an agent, for the turn's prompt
 * (`lib/chat/handover.ts`), or `undefined`.
 *
 * Only for the app's own chat: a turn sent with an API key has no header to
 * point at, and the key's owner may not be the person reading the reply.
 *
 * The seam answers the person's facts (`readTaskHandoverFacts`: their active
 * projects with agent counts and edit rights, and whether agents may start);
 * the control names come from the same catalogs the app renders, in the
 * person's interface language, so the reply quotes what they see. A failed
 * read degrades to no note with a warning rather than refusing the turn: the
 * note helps a hand-over, and a hiccup there must never brick chat.
 */
export async function readTaskHandover(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    userId: string;
    locale: string;
    /** The API key the turn was sent with, when it came through REST. */
    apiKeyId?: string;
  },
): Promise<TaskHandover | undefined> {
  if (args.apiKeyId !== undefined) return undefined;
  try {
    const facts: unknown = await ctx.runQuery(
      internal.chat.handover.getTaskHandoverInternal,
      { organizationId: args.organizationId, userId: args.userId },
    );
    if (!isRecord(facts) || !Array.isArray(facts.projects)) return undefined;
    const projects = facts.projects.filter(
      (
        project,
      ): project is { name: string; agentCount: number; canEdit: boolean } =>
        isRecord(project) &&
        typeof project.name === 'string' &&
        typeof project.agentCount === 'number' &&
        typeof project.canEdit === 'boolean',
    );
    const label = (path: string) => catalogString(args.locale, path) ?? path;
    return {
      projectsWithAgents: projects
        .filter((project) => project.agentCount > 0)
        .map((project) => project.name),
      projectsWithoutAgents: projects.filter(
        (project) => project.agentCount === 0,
      ).length,
      canAddAgents: projects.some(
        (project) => project.agentCount === 0 && project.canEdit,
      ),
      automationOff: facts.automationEnabled !== true,
      standardAgent: facts.standardAgent === true,
      labels: {
        createTask: label('chat.createTask.headerButton'),
        createAndStart: label('tasks.actions.createAndStart'),
        assignee: label('tasks.fields.assignee'),
        createAgent: label('tasks.assignee.createAgent'),
        standardAgent: label('tasks.assignee.standardAgent'),
      },
    };
  } catch (error) {
    console.warn(
      `[chat] hand-over note unavailable for user ${args.userId} in organization ${args.organizationId} — replying without it:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
