import type { Sql } from 'postgres';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import type { SkillViewer } from '../../../lib/skills/visibility.ts';
import type { TurnWorkTools } from '../../core/chat/turn_action.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import {
  readThreadFiles,
  storeThreadArtifact,
} from '../agent_tools/artifacts.ts';
import { turnWorkToolsFor } from '../agent_tools/executor.ts';
import { turnImageBilling } from '../agent_tools/image-billing.ts';
import { offeredImageModel } from '../agent_tools/image-model.ts';
import type {
  Escalation,
  InputFile,
  WorkToolScope,
} from '../agent_tools/scope.ts';
import { listSkillCatalog } from '../agent_tools/skills.ts';
import { readProjectAgentSkillScope } from './agent-skill-scope.ts';
import type { TaskBriefFile } from './task-brief-read.ts';

/**
 * The work tools of a task run on the native engine — the same tools a chat
 * reply makes things with (`agent_tools/`), over the task's lane.
 *
 * What the lane decides: a produced file binds to the run's transcript thread
 * (and reaches the task as a deliverable when the run settles); the files a
 * tool may read back are the task's own — what its people attached and what
 * earlier runs delivered — beside the run's; the skills are the agent's
 * EQUIPPED ones, read as its project would (the harness stages the same
 * set); an image is booked to the person the run acts for, under the agent,
 * on the project; the light sandbox is the run's; and the full workspace is
 * the agent's harness, reached by `use_workspace` when the run has a runtime
 * to hand its work to.
 */

/** How long a run's code waits for a light sandbox when the organization's
 * are all running code: a run has no one to ask again, and a sandbox frees
 * within the three minutes a call may take. */
export const NATIVE_LIGHT_SANDBOX_WAIT_MS = 90_000;

export interface NativeWorkTurn {
  readonly organizationId: string;
  readonly projectId: string;
  readonly agentId: string;
  /** The person the run acts for: the sandbox's creator, the spend's
   * subject, the uploader of every file it makes. */
  readonly userId: string;
  readonly apiKeyId?: string;
  /** The run — the key of its light sandbox. */
  readonly runId: string;
  /** The run's transcript thread: where its generation row, its spend hold
   * and the files it makes live. */
  readonly threadId: string;
  /** The skills the agent is equipped with. */
  readonly skills: readonly string[];
  /** The task's files a tool may read back. */
  readonly taskFiles: readonly TaskBriefFile[];
  /** The hand-over to the agent's harness, when the run has one. */
  readonly escalation?: Escalation;
}

/** The files a tool may read among `refs`: the run's own (made by an earlier
 * tool call) and the task's. A ref naming anything else — another task's
 * file, a typo — is absent, so a tool never reads past the task. */
export async function readRunFiles(
  sql: Sql,
  scope: {
    organizationId: string;
    threadId: string;
    taskFiles: readonly TaskBriefFile[];
  },
  refs: readonly string[],
): Promise<Map<string, InputFile>> {
  const found = await readThreadFiles(
    sql,
    { organizationId: scope.organizationId, threadIds: [scope.threadId] },
    refs,
  );
  const names = new Map(scope.taskFiles.map((file) => [file.fileId, file]));
  const wanted = refs.filter((ref) => names.has(ref) && !found.has(ref));
  if (wanted.length === 0) return found;
  const rows = await sql<
    { ref: string; mediaType: string; sizeBytes: number }[]
  >`
    SELECT storage_ref AS ref, content_type AS "mediaType",
           size::float8 AS "sizeBytes"
    FROM app.file_metadata
    WHERE org_id = ${scope.organizationId}
      AND storage_ref = ANY(${[...wanted]})
  `;
  for (const row of rows) {
    const entry = names.get(row.ref);
    if (entry === undefined || found.has(row.ref)) continue;
    found.set(row.ref, {
      ref: row.ref,
      name: entry.fileName,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
    });
  }
  return found;
}

/**
 * The skills the agent equips that its project cannot reach: a bundle that
 * does not exist, or one not shared with the project's teams. The harness
 * fails a run over the first of them when it stages the skills; the native
 * engine checks the same set before it starts, so the two engines refuse the
 * same runs.
 */
export async function missingEquippedSkills(
  sql: Sql,
  args: { organizationId: string; agentId: string; skills: readonly string[] },
): Promise<string[]> {
  if (args.skills.length === 0) return [];
  const [orgSlug, skillScope] = await Promise.all([
    resolveOrgSlug(sql, args.organizationId),
    readProjectAgentSkillScope(sql, args.agentId),
  ]);
  if (orgSlug === null) return [...args.skills];
  const reachable = new Set(
    (
      await listSkillCatalog(
        orgSlug,
        projectSkillViewer(skillScope),
        args.skills,
      )
    ).map((entry) => entry.slug),
  );
  return args.skills.filter((slug) => !reachable.has(slug));
}

/** A project agent sees skills as its project does; an agent whose project is
 * gone falls back to the organization's own. */
function projectSkillViewer(scope: { teamIds: string[] } | null): SkillViewer {
  return scope === null
    ? { kind: 'org' }
    : { kind: 'project', teamIds: scope.teamIds };
}

export async function nativeWorkTools(
  sql: Sql,
  turn: NativeWorkTurn,
): Promise<TurnWorkTools | undefined> {
  const [orgSlug, skillScope, imageModel] = await Promise.all([
    resolveOrgSlug(sql, turn.organizationId),
    readProjectAgentSkillScope(sql, turn.agentId),
    offeredImageModel(sql, turn.organizationId),
  ]);
  if (orgSlug === null) return undefined;
  const skillViewer = projectSkillViewer(skillScope);
  const skillCatalog = await listSkillCatalog(
    orgSlug,
    skillViewer,
    turn.skills,
  );
  const loadout: WorkLoadout = {
    createFile: true,
    generateImage: imageModel !== undefined,
    skills: skillCatalog.length > 0,
    runCode: true,
    escalate: turn.escalation !== undefined,
  };
  const scope: WorkToolScope = {
    sql,
    organizationId: turn.organizationId,
    orgSlug,
    userId: turn.userId,
    skillViewer,
    skillAllowlist: turn.skills,
    sandboxOwnerKey: turn.runId,
    lightSandboxWaitMs: NATIVE_LIGHT_SANDBOX_WAIT_MS,
    loadout,
    artifacts: {
      store: (file) =>
        storeThreadArtifact(
          sql,
          {
            organizationId: turn.organizationId,
            userId: turn.userId,
            threadId: turn.threadId,
            projectId: turn.projectId,
          },
          file,
        ),
    },
    inputs: {
      resolve: (refs) =>
        readRunFiles(
          sql,
          {
            organizationId: turn.organizationId,
            threadId: turn.threadId,
            taskFiles: turn.taskFiles,
          },
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
              projectIds: [turn.projectId],
              agentSlug: turn.agentId,
              unit: 'run',
            }),
          },
        }
      : {}),
    ...(turn.escalation !== undefined ? { escalation: turn.escalation } : {}),
  };
  return turnWorkToolsFor(scope, skillCatalog);
}
