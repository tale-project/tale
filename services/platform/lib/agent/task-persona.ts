/**
 * The persona of a task's native turn — who the agent is when a project
 * agent works a task on the engine a chat reply runs on.
 *
 * The same pieces the chat assistant is made of, composed for the other
 * lane: the agent's own standing instructions lead (a project agent has a
 * voice and a remit of its own; the standard agent's are the organization's),
 * then what is true of every task run, then the work ladder for the tools the
 * run offers, then the task language policy, then the two rules every agent
 * keeps. The text changes with the agent's configuration, the run's loadout
 * and the task's language policy, so it is stable across the turns of a run
 * and sits in the cached prefix; the task itself is the user message
 * (`task-brief.ts`).
 *
 * Layer A: pure data.
 */

import { NO_FABRICATION, NO_RAW_CONTEXT } from '../chat/assistant';
import type { ResolvedAgent } from '../chat/turn';
import { renderWorkLadder, type WorkLoadout } from './ladder';

/** What is true of a task run, whichever agent works it. */
const TASK_RUN =
  "**THIS RUN** — the user message is the brief of a task in this workspace's project. You work it alone, start to finish, with your tools: nobody answers questions while you work, so do not ask for input — decide what the brief allows and say in your report what you assumed. What you make with a tool is attached to the task when you finish. Your last message is posted to the task as your report, for a person to review: say what you did, what you made, and what is still open or needs a person's decision.";

/**
 * The persona for a run of the agent `agentId` offering `loadout`. The slug
 * is the agent's id — the axis the run's spend is booked under, as the
 * harness books it — and `instructions` the agent's own, when it has any.
 */
export function taskAgentFor(args: {
  agentId: string;
  instructions: string | null | undefined;
  loadout: WorkLoadout;
  /** The task language policy (`agentLanguageGuidance`): the same words the
   * harness is given, so both engines write in the language of the task. */
  language?: string;
}): ResolvedAgent & { readonly instructions: string } {
  const own = args.instructions?.trim() ?? '';
  const ladder = renderWorkLadder(args.loadout);
  return {
    slug: args.agentId,
    instructions: [
      ...(own !== '' ? [own] : []),
      TASK_RUN,
      ...(ladder !== undefined ? [ladder] : []),
      ...(args.language !== undefined ? [args.language] : []),
      NO_FABRICATION,
      NO_RAW_CONTEXT,
    ].join('\n\n'),
  };
}
