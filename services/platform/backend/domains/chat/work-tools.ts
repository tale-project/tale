import { DEFAULT_CHAT_TOOLS } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { UserSkillViewer } from '../../../lib/skills/visibility.ts';
import { findActingMember, getUserTeamIds } from '../../auth/membership.ts';
import type { TurnWorkTools } from '../../core/chat/turn_action.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import {
  resolveImageGenerationModel,
  type ResolvedImageModel,
} from '../../core/lib/providers/resolve_image_model.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import {
  createWorkToolExecutor,
  workToolDocs,
} from '../agent_tools/executor.ts';
import type { WorkToolScope } from '../agent_tools/scope.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';
import { readThreadFiles, storeThreadArtifact } from './artifacts.ts';
import { chatImageBilling } from './image-billing.ts';
import { chatShimHandlers } from './shim.ts';

/**
 * The chat assistant's work tools for one turn — what lets a chat make the
 * file it is asked for instead of pointing at a task.
 *
 * The organization's `chat_tools` policy decides which tools a turn
 * offers; `image_generation` decides the image tool, as it does for the
 * agents. The tools act for the person whose chat it is: the skills they
 * see, the files of their conversation, their spend. A produced file binds
 * to the conversation's lineage root, where the person's uploads bind too.
 * Code runs in the conversation's light sandbox, keyed by that same root,
 * so every version of the chat shares it.
 */

export interface ChatWorkTurn {
  readonly organizationId: string;
  readonly userId: string;
  readonly apiKeyId?: string;
  readonly rootThreadId: string;
  readonly threadIds: readonly string[];
  readonly projectId: string | null;
  /** The thread the turn writes into — where its generation row, and so
   * its spend hold, lives. */
  readonly threadId: string;
}

/** The image model a chat turn may use, or `undefined` — policy off, or
 * nothing can serve it. Resolved over the provider credentials the way the
 * agent turns resolve it; a failure offers no image tool rather than
 * failing the turn. */
async function chatImageModel(
  sql: Sql,
  organizationId: string,
): Promise<ResolvedImageModel | undefined> {
  const policy = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'image_generation',
  );
  if (policy?.enabled !== true) return undefined;
  // The turn's own ctx: the same handlers that resolve the chat's model
  // resolve the image model, whichever module hosts each of them.
  const shim = createCtxShim(chatShimHandlers(sql));
  try {
    const model = await resolveImageGenerationModel(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reads org slugs, provider credentials and one policy, all served by these handlers
      shim as unknown as ActionCtx,
      organizationId,
    );
    return model ?? undefined;
  } catch (error) {
    console.warn(
      `[chat] image generation not offered to this turn for ${organizationId}:`,
      error,
    );
    return undefined;
  }
}

export async function chatWorkTools(
  sql: Sql,
  turn: ChatWorkTurn,
): Promise<TurnWorkTools | undefined> {
  const [policy, orgSlug, member, teamIds, imageModel] = await Promise.all([
    readGovernancePolicyForOrg(sql, turn.organizationId, 'chat_tools'),
    resolveOrgSlug(sql, turn.organizationId),
    findActingMember(sql, turn.organizationId, turn.userId),
    getUserTeamIds(sql, turn.organizationId, turn.userId),
    chatImageModel(sql, turn.organizationId),
  ]);
  if (orgSlug === null || member === null) return undefined;
  const switches = policy ?? DEFAULT_CHAT_TOOLS;
  const loadout: WorkLoadout = {
    createFile: switches.files,
    generateImage: imageModel !== undefined,
    skills: switches.skills,
    runCode: switches.code,
  };
  const skillViewer: UserSkillViewer = {
    kind: 'user',
    userId: turn.userId,
    teamIds,
    isOrgAdmin: defineAbilityFor(member.role).can('write', 'orgSettings'),
  };
  const projectIds = turn.projectId !== null ? [turn.projectId] : [];
  const scope: WorkToolScope = {
    sql,
    organizationId: turn.organizationId,
    orgSlug,
    userId: turn.userId,
    skillViewer,
    sandboxOwnerKey: turn.rootThreadId,
    loadout,
    artifacts: {
      store: (file) =>
        storeThreadArtifact(
          sql,
          {
            organizationId: turn.organizationId,
            userId: turn.userId,
            threadId: turn.rootThreadId,
            ...(turn.projectId !== null ? { projectId: turn.projectId } : {}),
          },
          file,
        ),
    },
    inputs: {
      resolve: (refs) =>
        readThreadFiles(
          sql,
          { organizationId: turn.organizationId, threadIds: turn.threadIds },
          refs,
        ),
    },
    ...(imageModel !== undefined
      ? {
          image: {
            model: imageModel,
            billing: chatImageBilling(sql, {
              organizationId: turn.organizationId,
              userId: turn.userId,
              ...(turn.apiKeyId !== undefined
                ? { apiKeyId: turn.apiKeyId }
                : {}),
              threadId: turn.threadId,
              projectIds,
            }),
          },
        }
      : {}),
  };
  const executor = createWorkToolExecutor(scope);
  if (executor === undefined) return undefined;
  return {
    executor,
    toolDocs: workToolDocs(scope),
    loadout,
    skillCatalog: loadout.skills
      ? await listSkillCatalog(orgSlug, skillViewer)
      : [],
  };
}
