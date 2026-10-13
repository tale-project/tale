import {
  type ChatToolsConfig,
  DEFAULT_CHAT_TOOLS,
} from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import { CHAT_ASSISTANT_SLUG } from '../../../lib/chat/assistant.ts';
import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import type { UserSkillViewer } from '../../../lib/skills/visibility.ts';
import { findActingMember, getUserTeamIds } from '../../auth/membership.ts';
import type {
  TurnWorkTools,
  WorkToolsUnavailable,
} from '../../core/chat/turn_action.ts';
import { ConfigurationError } from '../../core/lib/config_store/precondition.ts';
import {
  readGovernancePolicyForOrg,
  resolveOrgSlug,
} from '../../lib/org-config.ts';
import {
  readThreadFiles,
  storeThreadArtifact,
} from '../agent_tools/artifacts.ts';
import { turnWorkToolsFor } from '../agent_tools/executor.ts';
import { turnImageBilling } from '../agent_tools/image-billing.ts';
import { offeredImageModel } from '../agent_tools/image-model.ts';
import type { WorkToolScope } from '../agent_tools/scope.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';

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

/** Every switch off: what a policy that cannot be read is held to. */
const NO_CHAT_TOOLS: ChatToolsConfig = {
  files: false,
  skills: false,
  code: false,
};

/**
 * The organization's chat tool switches: the policy as written, the defaults
 * when no file says otherwise, and every switch OFF when the policy cannot be
 * read — a file that exists and fails to parse, a configuration root that is
 * not set or not readable, a read that failed. A switch an admin turned off
 * is a decision about what code may run; a policy that cannot be read must
 * not quietly turn the decision back on — the Governance page names the
 * problem, and the tools return once it can be read. Only an absent file is
 * the defaults.
 */
async function readChatToolSwitches(
  sql: Sql,
  organizationId: string,
): Promise<{ switches: ChatToolsConfig; unreadable: boolean }> {
  try {
    return {
      switches:
        (await readGovernancePolicyForOrg(sql, organizationId, 'chat_tools', {
          strict: true,
        })) ?? DEFAULT_CHAT_TOOLS,
      unreadable: false,
    };
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
    console.warn(
      `[chat] the chat_tools policy of ${organizationId} cannot be read, so no chat tool is offered until it is repaired:`,
      error.message,
    );
    return { switches: NO_CHAT_TOOLS, unreadable: true };
  }
}

/**
 * The turn's work tools: what the policy allows, built for the person. A
 * policy that cannot be read still offers images, which it does not
 * govern, and says why the rest is missing; so does a turn whose
 * organization or member cannot be resolved, which offers nothing.
 */
export async function chatWorkTools(
  sql: Sql,
  turn: ChatWorkTurn,
): Promise<TurnWorkTools | WorkToolsUnavailable | undefined> {
  const [policy, orgSlug, member, teamIds, imageModel] = await Promise.all([
    readChatToolSwitches(sql, turn.organizationId),
    resolveOrgSlug(sql, turn.organizationId),
    findActingMember(sql, turn.organizationId, turn.userId),
    getUserTeamIds(sql, turn.organizationId, turn.userId),
    offeredImageModel(sql, turn.organizationId),
  ]);
  if (orgSlug === null || member === null) {
    console.warn(
      `[chat] work tools for ${turn.organizationId} were not set up: ${orgSlug === null ? 'the organization has no slug' : 'the person is not a member'}`,
    );
    return { unavailable: 'setup_failed' };
  }
  const switches = policy.switches;
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
            billing: turnImageBilling(sql, {
              organizationId: turn.organizationId,
              userId: turn.userId,
              ...(turn.apiKeyId !== undefined
                ? { apiKeyId: turn.apiKeyId }
                : {}),
              threadId: turn.threadId,
              projectIds,
              agentSlug: CHAT_ASSISTANT_SLUG,
              unit: 'reply',
            }),
          },
        }
      : {}),
  };
  const tools = turnWorkToolsFor(
    scope,
    loadout.skills ? await listSkillCatalog(orgSlug, skillViewer) : [],
  );
  if (!policy.unreadable) return tools;
  return tools === undefined
    ? { unavailable: 'policy_unreadable' }
    : { unavailable: 'policy_unreadable', tools };
}
