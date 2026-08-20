/**
 * Deterministic content streamed by the chat-completions override, shared
 * between the override producer (`chat-completions.ts`) and the chat specs
 * (assertions) so the two can never drift.
 *
 * The default reply is `CANNED_REPLY`. The remaining constants drive the
 * keyword-gated "scenario" branches: a user message containing one of
 * `MOCK_TRIGGERS` makes the mock emit a richer stream (reasoning, structured
 * next-steps, or a tool call) instead of the plain canned reply. Messages with
 * no trigger keyword always get `CANNED_REPLY` verbatim, so the default-path
 * specs (chat / chat-threads / chat-advanced / …) are unaffected.
 *
 */

/** The default assistant reply for any message with no trigger keyword. */
export const CANNED_REPLY =
  'Hello from the Tale E2E mock assistant. This reply is canned and deterministic.';

/**
 * Substrings that switch the mock into a scenario. A user message containing
 * one of these (case-insensitive) triggers the matching branch. Kept lowercase
 * and prefixed so they can never collide with the default-path specs' messages.
 */
export const MOCK_TRIGGERS = {
  reasoning: 'e2e:reasoning',
  nextSteps: 'e2e:nextsteps',
  humanInput: 'e2e:humaninput',
  error: 'e2e:error',
  fileWrite: 'e2e:filewrite',
  plan: 'e2e:plan',
} as const;

/**
 * Error scenario (`MOCK_TRIGGERS.error`): the generation call returns an HTTP
 * 500 so the chat surfaces its provider-failure UI. Only the streaming
 * generation call fails — the JSON router/title calls still get the canned
 * `{}`, so the failure lands on the assistant turn, not on routing.
 */
export const CANNED_ERROR_MESSAGE = 'E2E induced provider error';

/**
 * Reasoning scenario (`MOCK_TRIGGERS.reasoning`): streamed first as
 * `delta.reasoning_content` (→ a "Thinking" disclosure), then the answer as
 * normal `delta.content`.
 */
export const CANNED_REASONING =
  'Let me think through this step by step before answering.';
export const CANNED_REASONING_ANSWER =
  'Based on that reasoning, here is the deterministic answer.';

/**
 * Structured-output scenario (`MOCK_TRIGGERS.nextSteps`): plain text carrying a
 * `[[NEXT_STEPS]]` marker. The frontend marker parser renders each item line as
 * a clickable follow-up button. Each item must be alone on its own line.
 */
const CANNED_NEXT_STEPS_ITEMS = [
  'Review the quarterly budget',
  'Compare it with last quarter',
] as const;
export const CANNED_NEXT_STEPS_TEXT = [
  'Here is the plan you asked for.',
  '',
  '[[NEXT_STEPS]]',
  ...CANNED_NEXT_STEPS_ITEMS,
].join('\n');

/**
 * Tool-call scenario (`MOCK_TRIGGERS.humanInput`): the mock emits a
 * `request_human_input` tool call on the first turn (→ an approval card), and a
 * plain-text acknowledgement once the conversation already contains the tool
 * call / response (the resume turn). The args satisfy the tool's zod schema
 * (`convex/agent_tools/human_input/request_human_input_tool.ts`): one required
 * `text` field.
 */
export const CANNED_HUMAN_INPUT_QUESTION =
  'What should we name the new workspace?';
export const CANNED_HUMAN_INPUT_FIELD_LABEL = 'Workspace name';
export const CANNED_HUMAN_INPUT_ACK =
  'Thank you — I have recorded your response.';

/**
 * File-write scenario (`MOCK_TRIGGERS.fileWrite`): on the first turn the mock
 * emits one `file_write` tool call per entry below (the real tool executes
 * server-side — no sandbox needed, unlike `run_code` — so the files land in
 * the thread workspace and the Canvas / Workspace-files panes render them
 * offline). On the resume turn (tool results present) it streams
 * `CANNED_FILE_WRITE_ACK` as plain text instead of re-emitting the calls.
 *
 * One entry per Canvas renderer so a single scenario exercises them all:
 * markdown (Source/Preview + rendered), Mermaid, a sandboxed-iframe HTML page,
 * inline SVG, and a code file. Paths sit under `/agent/output/` (deliverables)
 * so they show under the Output group of the file tree. Kept tiny + inert.
 */
export const CANNED_FILE_WRITE_FILES = [
  {
    path: '/agent/output/report.md',
    content:
      '# Quarterly report\n\nDeterministic mock deliverable.\n\n- One\n- Two\n',
  },
  {
    path: '/agent/output/diagram.mmd',
    content: 'graph TD;\n  A[Start] --> B[End];\n',
  },
  {
    path: '/agent/output/page.html',
    content:
      '<!doctype html><html><body><h1>Mock page</h1><p>Rendered in the sandboxed iframe.</p></body></html>\n',
  },
  {
    path: '/agent/output/logo.svg',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>\n',
  },
  {
    path: '/agent/output/analysis.py',
    content: 'print("deterministic mock output")\n',
  },
] as const;
export const CANNED_FILE_WRITE_ACK =
  'I have written the workspace files. Open the Canvas pane to review them.';

/**
 * Plan scenario (`MOCK_TRIGGERS.plan`): on the first turn the mock emits one
 * `update_todos` call seeding the plan (three todos, the first in progress —
 * the "at most one in_progress" invariant holds), so the Research-plan pane
 * renders offline. On the resume turn it streams `CANNED_PLAN_ACK`.
 */
export const CANNED_PLAN_TODOS = [
  { id: 'gather', content: 'Gather the source material' },
  { id: 'analyze', content: 'Analyze the findings' },
  { id: 'summarize', content: 'Summarize the result' },
] as const;
export const CANNED_PLAN_ACK =
  'I have drafted the plan. Track progress in the Plan pane.';
