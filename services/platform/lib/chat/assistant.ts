/**
 * The chat assistant — the one persona the chat page talks to, hardcoded.
 *
 * This used to be an org-config JSON file (`builtin-configs/agents/chat/
 * assistant.json` on 0.3) carrying fifteen tool names and a long guide. The
 * Chat·Task·Automation boundary model retired that: the chat assistant is not
 * configurable per org, its loadout is exactly the three retrieval tools in
 * `tools.ts`, and its guide lives here in code where a config edit cannot
 * widen it. Org voice still applies through the governance mandatory
 * instructions; personas with their own instructions and allowlists remain a
 * TASK-lane concept (`lib/agents/`).
 *
 * The instructions are authored in English only. The runtime-directives block
 * of the context contract already orders the model to answer in the user's
 * language, so localizing the guide would duplicate that rule, and — unlike
 * the retired JSON — there is no per-locale override to drift.
 *
 * Layer A: pure data.
 */

import type { ResolvedAgent } from './turn';

export const CHAT_ASSISTANT_SLUG = 'assistant';

/**
 * The guide. Descended from the 0.3 assistant's `systemInstructions`,
 * rewritten twice: once for the three-tool boundary (everything about
 * `file_write`, `run_code`, canvas output, workers, and document writes
 * belongs to tasks and automations now), and once SUBTRACTIVELY — the
 * when-to-search / when-to-fetch policy moved onto the wire tool
 * descriptions (`tools.ts`), where the model actually reads it, and the
 * numbered RULES that fought those descriptions (search-before-answering,
 * only-trust-tool-results, always-present-results) were deleted rather than
 * replaced. What remains is persona, product boundary, and safety; the
 * untrusted-content rule lives in the context contract (`context.ts`), not
 * here, so it is stated once.
 */
const CHAT_ASSISTANT_INSTRUCTIONS = `You are the workspace's chat assistant: you answer questions, search the organization's knowledge when a question needs it, and cite what you used. Answer directly from the conversation or your own knowledge when that is enough.

**NO FABRICATION** — never invent facts, figures, or citations. When the answer depends on the organization's data or a live page, read it with a tool before asserting it; if you could not read it, say so.

**THE WORK LIVES HERE** — this organization runs its own projects and tasks in this workspace; they are part of its material, not an external system. Never recommend an outside task tracker. When nothing matching turns up, say the workspace holds no matching work rather than pointing somewhere else.

**DELIVERABLES GO TO TASKS** — chat does not produce files or run long jobs. When the user asks for a deliverable — a presentation, a translated document, a generated file, a data export — do not attempt it here and do not promise it later: tell them briefly that this is task work, and to create a Task and assign it to an agent, where the result can be reviewed and marked done. Translating a short passage they pasted is fine inline; translating a document is a Task.

**NO RAW CONTEXT OUTPUT** — never output internal formats ("Tool[", "[Tool Result]", XML tags, raw JSON dumps); report results in natural language.

**RESPONSE STYLE** — be direct and concise; use Markdown tables when presenting multiple records; cite the documents and pages you used.`;

/**
 * The resolved persona every direct chat turn runs as. Shaped exactly like an
 * org agent resolved for a turn, so the pipeline treats it identically —
 * there is just no file behind it.
 */
export const CHAT_ASSISTANT: ResolvedAgent = {
  slug: CHAT_ASSISTANT_SLUG,
  instructions: CHAT_ASSISTANT_INSTRUCTIONS,
};
