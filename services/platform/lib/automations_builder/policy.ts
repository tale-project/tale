/**
 * Session policy for the automation builder agent — constants and prompt
 * injections, separated from the loop so the numbers can be read (and argued
 * with) on their own.
 *
 * Every value here is a measured decision rather than a preference, and the
 * measurements were taken on small models, which is the class this loop must
 * carry. Changing one is a legitimate act; changing one on intuition is not.
 *
 * The agent's whole vocabulary is the engine's dispatch table, and the guide
 * it works from is generated from that same registry (`agentDocs()`), so the
 * prompt cannot drift from the methods that actually exist. This module adds
 * only what a *session* needs on top of the guide: how a job finishes, and
 * the two short nudges that keep a weak model verifying its own work.
 */

import { agentDocs } from '../engine/api/docs';
import { resultFacts } from './results';

/** The knobs a session runs on. Every one has a measured default below; a
 * host overrides individual values, never the set. */
export interface BuilderPolicy {
  maxTurns: number;
  restartAfterFruitless: number;
  maxRestarts: number;
  deadlineMs: number;
  maxHistoryChars: number;
  temperature: number;
  restartTemperature: number;
}

export const BUILDER_POLICY: BuilderPolicy = {
  /**
   * A solved authoring job converges in about three turns; the budget exists
   * for the tail, not the median. Past this the session ends with a reason
   * instead of spending more of the org's money on a model that is not
   * converging.
   */
  maxTurns: 14,

  /**
   * Consecutive turns without progress before the attempt is abandoned. Two
   * fresh six-turn attempts solve as often as one twelve-turn grind at about
   * half the expected cost — a stuck session is restarted, never nursed.
   */
  restartAfterFruitless: 6,

  /**
   * How many fresh attempts a session may take. Past the first restart the
   * evidence for another one runs out, so the session ends cleanly instead of
   * looping.
   */
  maxRestarts: 1,

  /**
   * Wall-clock ceiling for the whole session. Stragglers past this point
   * rarely recover, and a session holds a job slot while it runs.
   */
  deadlineMs: 420_000,

  /**
   * Character ceiling for the conversation the model is sent. The transcript
   * is NEVER summarized: full history solves markedly more jobs than any
   * trimmed window, and an LLM-written summary silently drops the one error
   * detail the next turn needed. When the window is genuinely exhausted the
   * OLDEST turns are dropped verbatim and the model is told so — visible
   * loss, never invented content.
   */
  maxHistoryChars: 120_000,

  /** Sampling for a first attempt: nearly deterministic. */
  temperature: 0.1,

  /**
   * Sampling after a restart. Measured pass rates at 0.1 and 0.7 are
   * identical, so the variation is free — and a restarted attempt needs to
   * not re-derive the dead end it just abandoned.
   */
  restartTemperature: 0.7,
};

/**
 * How a builder session ends. The engine's own guide stops at "finish per
 * your task's instructions", because finishing is the host's rule, not the
 * engine's: here the job is done when a tested document has been saved.
 */
const FINISH_DOCS = `

## Finishing this job (there is no "submit" here)
1. When run_automation's output and effects are exactly right, add a top-level tests: block covering at least one realistic input.
2. Call test_automation — every test must pass.
3. Then call save_automation with a short message. A successful save completes the job.
save_automation is REJECTED until test_automation has passed for that exact document — edit the document after testing and you must test it again.`;

/** The system prompt: the generated engine guide plus the finish rule. */
export function builderSystemPrompt(): string {
  return agentDocs() + FINISH_DOCS;
}

/** The opening message: the job, and the instruction to start working. */
export function builderTaskPrompt(goal: string): string {
  return `# Job\n${goal}\n\nBuild the automation, run it with a realistic test input, attach tests, verify with test_automation, then save_automation. Start now.`;
}

/**
 * Injected after a result that shows a failure. Forcing a one-line diagnosis
 * before the next action is one of only two prompt techniques that measurably
 * raise the solve rate — small models fail at diagnosing, not at writing.
 */
export const REFLECTION_NUDGE =
  'Begin your reply with exactly one line "CAUSE: <one-sentence diagnosis>", then output the corrected action.';

/**
 * Injected at the points where the agent could plausibly believe it is done.
 * The other measured technique: verification structure. Everything else
 * (personas, plan-first, few-shot examples, terser docs) measured at or below
 * baseline, so this loop injects these two and nothing else.
 */
export const CHECKLIST_NUDGE =
  'Before you finish, run the pre-submit checklist: (1) did the run succeed on a realistic input, (2) does the output match the job character by character and type by type, (3) do the effects match exactly — right target, exact text, correct count, nothing extra? Only if all three are yes may you finish.';

/** Reply to a turn that carried no usable action. */
export function protocolNudge(parseError: string): string {
  return `Protocol error: ${parseError}\nReply with exactly ONE action in a single fenced yaml block: method: <name> and params: {...}.`;
}

/** Appended when the reply deviated from the protocol but was recovered. */
export function leniencyNote(deviation: string): string {
  return `Protocol note: your last reply ${deviation}. It was recovered this time — reply with exactly one fenced yaml block from now on.`;
}

/**
 * Per-action guidance appended to every engine result. Small models drop off
 * the loop when a result is handed back without a next step; naming that step
 * costs one line and keeps them on it.
 */
export function nudgeFor(method: string, result: unknown): string {
  const facts = resultFacts(result);
  switch (method) {
    case 'get_docs':
    case 'get_catalog':
      return 'Now draft the complete automation and call run_automation with a realistic test input.';
    case 'search_catalog':
      return facts.matches > 0
        ? 'Pick the best-matching capability (use its exact type and input schema), then draft the automation and run it.'
        : 'No matches — call search_catalog again with different capability keywords (verbs + objects).';
    case 'validate_automation':
      return facts.valid === true
        ? 'No errors. Next: run_automation with a realistic test input.'
        : 'Fix every error above, then call run_automation.';
    case 'run_automation':
      if (facts.status === 'success') {
        return 'Execution succeeded. Compare output and effects against the job character by character. If they match → attach tests and call test_automation. If not → fix and re-run.';
      }
      if (facts.status === 'invalid') {
        return 'Validation failed — nothing executed. Fix every error in validation.errors, then call run_automation again.';
      }
      return 'Execution failed. Use error, hint and trace to fix the automation, then call run_automation again.';
    case 'test_automation':
      return facts.testsPassed
        ? 'All tests pass — call save_automation with the SAME document to finish.'
        : 'Fix the automation (or the tests) until every test passes.';
    case 'save_automation':
      return facts.saved
        ? 'Saved.'
        : 'The save was refused. Read the error, fix what it names, then try again.';
    default:
      return '';
  }
}

/** The two moments where an agent may wrongly believe the job is done. */
export function invitesFinish(method: string, result: unknown): boolean {
  const facts = resultFacts(result);
  if (method === 'run_automation') return facts.status === 'success';
  if (method === 'test_automation') return facts.testsPassed;
  return false;
}
