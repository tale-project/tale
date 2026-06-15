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
}): string {
  const isPlan = opts.permissionMode === 'plan';
  return [
    opts.systemInstructions,
    isPlan ? PLAN_MODE_ADDENDUM : STEERING_RESPONSIVENESS_ADDENDUM,
    UNTRUSTED_CONTENT_SYSTEM_PROMPT,
  ]
    .filter((s): s is string => s !== undefined && s !== '')
    .join('\n\n');
}
