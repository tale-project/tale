// Pure assembly of the external-agent system-prompt append (composed with the
// agent's own instructions, never replacing them). Kept Convex-free so it can
// be unit-tested without the 'use node' action module that consumes it.

import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../../lib/untrusted_content';

// Appended to a PLAN turn. The in-image tale-plan-gate hook is the hard stop —
// this just steers the model toward one clean ExitPlanMode call.
export const PLAN_MODE_ADDENDUM =
  'This is a read-only planning turn. Explore as needed, then call ' +
  'ExitPlanMode exactly once with the complete plan as the `plan` argument. ' +
  'The call will be denied — that is expected: present the complete plan in ' +
  'your final message and end your turn. The user reviews and approves the ' +
  'plan in the chat UI before any execution happens. Do not retry ' +
  'ExitPlanMode and do not start executing.';

// Appended to ACT turns. A long-blocking FOREGROUND command is a steering blind
// spot: the user's mid-run chat messages can only reach the model at a tool
// boundary, so a 20-minute foreground build holds them until it finishes.
// Backgrounding + polling creates frequent boundaries (BashOutput) where queued
// messages inject within seconds — without interrupting the work.
// Appended on browser-view sessions (the agent drives a managed Chromium over
// CDP). Without this, a wedged browser surfaces as a raw `connectOverCDP`
// timeout / "No open pages available" that the model loops on forever. The
// platform self-heals the browser before each turn and on demand, so the right
// move on a mid-turn failure is one reset attempt, then report — not spin.
export const BROWSER_VIEW_RECOVERY_ADDENDUM =
  'BROWSER RECOVERY: your browser tools drive a managed Chromium. If a browser ' +
  'tool fails with a connection/timeout error (e.g. "connectOverCDP", ' +
  '"Timeout … exceeded") or "No open pages available", do NOT keep retrying ' +
  'browser_navigate in a loop. Call browser_close once to drop the stale ' +
  'context, then try browser_navigate one more time. If it still fails, the ' +
  'browser is being recovered on the server — stop, tell the user the browser ' +
  'is restarting and that they can use “Reset browser” in the live-browser ' +
  'panel if it persists, and continue with other work instead of looping.';

export const STEERING_RESPONSIVENESS_ADDENDUM =
  'STAYING RESPONSIVE: a long-running foreground command blocks you from ' +
  'receiving new chat messages from the user until it returns. If a command ' +
  'is expected to run longer than ~30 seconds (builds, installs, ' +
  '`docker compose up` including with `--build`/`-d`, dev servers, full test ' +
  'suites, migrations), start it with the Bash tool option ' +
  '`run_in_background: true` and then poll its output with BashOutput. This ' +
  'keeps you responsive to the user mid-run without interrupting the work. ' +
  'Never block a foreground Bash on a long build or on a server you expect to ' +
  'stay up.';

// Appended on INTERACTIVE turns. The structured AskUserQuestion tool is
// disabled (it has no answer path in chat), so the agent must ask in prose; the
// user replies as a normal chat message and the turn continues from there.
export const ASK_IN_CHAT_ADDENDUM =
  'ASKING THE USER: when you need a decision or information only the user can ' +
  'provide, ask plainly in your reply and stop there — the user answers in ' +
  'chat and you continue from their response. There is no structured-question ' +
  'tool here. When a choice is low-stakes or reasonably inferable, just proceed ' +
  'and state what you assumed rather than blocking on a question.';

// Appended on AUTONOMOUS (no-human-in-the-loop) ACT turns — replaces the
// steering addendum. Nobody is watching: the agent must not ask, request human
// control, or wait for approval; it makes assumptions and runs to completion.
export const AUTONOMOUS_MODE_ADDENDUM =
  'AUTONOMOUS RUN: no human is available. Do NOT ask the user questions, do ' +
  'NOT request human control, and do NOT wait for approval — there is no one ' +
  'to respond. Make reasonable assumptions, proceed to completion on your own, ' +
  'and at the end clearly summarize what you did and the assumptions you made. ' +
  'If you genuinely cannot proceed, stop and explain why instead of waiting.';

// Appended on AUTONOMOUS PLAN turns — the plan-mode addendum's "the user
// reviews and approves in the chat UI" promise is false with no human, so this
// trims it: read-only, present the plan, end the turn, no approval step.
export const AUTONOMOUS_PLAN_ADDENDUM =
  'AUTONOMOUS PLANNING RUN: this is a read-only turn — explore as needed, then ' +
  'present the complete plan in your final message and end your turn. There is ' +
  'no approval step and no human to review it; do not ask questions, do not ' +
  'wait for confirmation, and do not start executing.';

/**
 * Compose the `--append-system-prompt` payload for a turn:
 *   - the agent's own configured instructions (first, never clobbered),
 *   - the plan-mode addendum on PLAN turns / the steering addendum on ACT turns,
 *   - the trust rules that make `<untrusted_source>` wrapping meaningful.
 * Empty/undefined parts are dropped; the rest are joined with blank lines.
 */
export function buildSystemPromptAppend(opts: {
  systemInstructions?: string;
  permissionMode?: string;
  /** Interaction posture. `autonomous` (no human in the loop) swaps the
   * steering / plan addenda for autonomous guidance — the agent must not ask or
   * wait for a human. `interactive` (default / absent) keeps the human-in-loop
   * addenda plus the ask-in-chat nudge (the structured-question tool is
   * disabled, so it asks in prose). */
  interactionMode?: string;
  /** Live-browser-view session: append browser-recovery guidance so a wedged
   * managed Chromium doesn't make the agent loop on raw CDP errors. */
  browserCdp?: boolean;
}): string {
  const isPlan = opts.permissionMode === 'plan';
  const isAutonomous = opts.interactionMode === 'autonomous';
  // Posture addendum: plan vs execute, crossed with interactive vs autonomous.
  const postureAddendum = isAutonomous
    ? isPlan
      ? AUTONOMOUS_PLAN_ADDENDUM
      : AUTONOMOUS_MODE_ADDENDUM
    : isPlan
      ? PLAN_MODE_ADDENDUM
      : STEERING_RESPONSIVENESS_ADDENDUM;
  return [
    opts.systemInstructions,
    postureAddendum,
    // Interactive only: AskUserQuestion is disabled, so steer the agent to ask
    // in prose instead of stalling or guessing. Autonomous must never ask.
    isAutonomous ? undefined : ASK_IN_CHAT_ADDENDUM,
    opts.browserCdp ? BROWSER_VIEW_RECOVERY_ADDENDUM : undefined,
    UNTRUSTED_CONTENT_SYSTEM_PROMPT,
  ]
    .filter((s): s is string => s !== undefined && s !== '')
    .join('\n\n');
}
