import { offersWork } from '../../../lib/agent/ladder.ts';
import type { SkillCatalogEntry } from '../../../lib/agent/skills-block.ts';
import {
  workToolDoc,
  workWireTool,
  type WorkToolName,
} from '../../../lib/agent/work-tools.ts';
import type { ToolDoc } from '../../../lib/chat/context.ts';
import type {
  ChatToolExecutor,
  ToolCallRequest,
} from '../../../lib/chat/tools.ts';
import type { TurnWorkTools } from '../../core/chat/turn_action.ts';
import { runCreateFile } from './create-file.ts';
import { runGenerateImage } from './image.ts';
import { runRunCode } from './run-code.ts';
import { failure, type WorkToolScope } from './scope.ts';
import { runLoadSkill, runReadSkillFile } from './skills.ts';
import { runUseWorkspace } from './use-workspace.ts';

/**
 * The work tools a turn offers, as one executor the turn pipeline injects
 * beside the lane's other tools (`lib/agent/compose.ts`).
 *
 * The scope's loadout decides what is on the wire; a tool is never offered
 * that the turn could not run — no image model, no image tool. Every call
 * answers a structured result and never throws: a failure is the model's to
 * read and recover from, not the end of the turn.
 */

type Handler = (scope: WorkToolScope, input: unknown) => Promise<unknown>;

const HANDLERS: Record<WorkToolName, Handler> = {
  create_file: runCreateFile,
  generate_image: runGenerateImage,
  load_skill: runLoadSkill,
  read_skill_file: runReadSkillFile,
  run_code: runRunCode,
  use_workspace: runUseWorkspace,
};

/** The work tools `scope` offers, in wire order. */
function offeredWorkTools(scope: WorkToolScope): WorkToolName[] {
  const { loadout } = scope;
  const tools: WorkToolName[] = [];
  if (loadout.skills) tools.push('load_skill', 'read_skill_file');
  if (loadout.createFile) tools.push('create_file');
  if (loadout.generateImage && scope.image !== undefined) {
    tools.push('generate_image');
  }
  if (loadout.runCode) tools.push('run_code');
  if (loadout.escalate === true && scope.escalation !== undefined) {
    tools.push('use_workspace');
  }
  return tools;
}

/** The system prompt's lines for the work tools `scope` offers. */
export function workToolDocs(scope: WorkToolScope): ToolDoc[] {
  return offeredWorkTools(scope).map(workToolDoc);
}

/**
 * What a turn takes from a work-tool scope: the executor, the lines its
 * system prompt lists for the tools, the loadout its persona's ladder is
 * written for, and the skills it may load. One assembly for every lane that
 * offers work tools — a chat reply, a task run — so the turn pipeline reads
 * the same shape from both. `undefined` when the scope offers no tool at all.
 */
export function turnWorkToolsFor(
  scope: WorkToolScope,
  skillCatalog: readonly SkillCatalogEntry[],
): TurnWorkTools | undefined {
  const executor = createWorkToolExecutor(scope);
  if (executor === undefined) return undefined;
  return {
    executor,
    toolDocs: workToolDocs(scope),
    loadout: scope.loadout,
    skillCatalog,
  };
}

export function createWorkToolExecutor(
  scope: WorkToolScope,
): ChatToolExecutor | undefined {
  if (!offersWork(scope.loadout)) return undefined;
  const offered = offeredWorkTools(scope);
  if (offered.length === 0) return undefined;
  const names = new Set<string>(offered);
  return {
    wireTools: offered.map(workWireTool),
    async execute(call: ToolCallRequest): Promise<unknown> {
      if (!names.has(call.name)) {
        return failure('error', `There is no tool named "${call.name}".`);
      }
      if (call.rawInput !== undefined) {
        return failure(
          'invalid_args',
          `The arguments of ${call.name} were not valid JSON. Send them again as one JSON object.`,
        );
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked above against the offered names
      const handler = HANDLERS[call.name as WorkToolName];
      try {
        return await handler(scope, call.input);
      } catch (error) {
        console.error(`[agent-tools] ${call.name} failed:`, error);
        return failure(
          'error',
          `${call.name} failed unexpectedly. Tell the user it did not work; do not retry the same call.`,
        );
      }
    },
  };
}
