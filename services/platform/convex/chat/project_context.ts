import type { ProjectContext } from '../../lib/chat/context';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

/**
 * The project block's inputs for a project-bound thread, or `undefined`.
 *
 * Access is re-checked here even though the composer already enforced it on
 * send: a thread carries its `projectId` for its whole life, so a user who
 * loses project access must stop receiving the project's instructions on the
 * NEXT turn rather than at some later reconciliation.
 * `assertProjectAccessForChat` is the same gate every other chat-to-project
 * touchpoint uses.
 *
 * A denial degrades to "no project block" rather than refusing the turn. The
 * thread is still the user's own conversation and its history still theirs to
 * read; what they lose is the project's name and standing instructions in the
 * prompt. Refusing outright would strand a thread nobody can continue.
 */
export async function resolveProjectContext(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    userId: string;
    projectId: Id<'projects'> | null;
  },
): Promise<ProjectContext | undefined> {
  if (args.projectId === null) return undefined;
  const access = await ctx.runQuery(
    internal.projects.internal_queries.assertProjectAccessForChat,
    {
      projectId: args.projectId,
      organizationId: args.organizationId,
      userId: args.userId,
    },
  );
  if (!access.allowed) return undefined;
  const project = await ctx.runQuery(
    internal.projects.internal_queries.getProjectForInjection,
    { projectId: args.projectId },
  );
  if (project === null) return undefined;
  return {
    name: project.name,
    ...(project.instructions !== undefined
      ? { instructions: project.instructions }
      : {}),
  };
}
