/**
 * The chat assistant — the one persona the chat page talks to, hardcoded.
 *
 * This used to be an org-config JSON file (`builtin-configs/agents/chat/
 * assistant.json` on 0.3) carrying fifteen tool names and a long guide. The
 * Chat·Task·Automation boundary model retired that: the chat assistant is not
 * configurable per org, its loadout is the three retrieval tools in
 * `tools.ts` plus the work tools its organization's Chat tools policy allows
 * (`lib/agent/work-tools.ts`), and its guide lives here in code where a
 * config edit cannot widen it. Org voice still applies through the governance mandatory
 * instructions; personas with their own instructions, skills and allowlists
 * are project agents working tasks (`backend/domains/projects/`) and
 * automation agent nodes.
 *
 * The instructions are authored in English only. The runtime-directives block
 * of the context contract already sets the reply language — the user's own,
 * or the one a REST caller fixed with `locale` — so localizing the guide
 * would duplicate that rule, and — unlike the retired JSON — there is no
 * per-locale override to drift.
 *
 * Layer A: pure data.
 */

import { renderWorkLadder, type WorkLoadout } from '../agent/ladder';
import type { ResolvedAgent } from './turn';

export const CHAT_ASSISTANT_SLUG = 'assistant';

/**
 * The index of Tale's public documentation, which the persona points
 * questions about Tale itself at. Fixed rather than derived from this
 * deployment's site origin: a self-hosted `TALE_SITE_URL` would yield a docs
 * host that does not exist, and the docs every deployment should read are
 * the public ones.
 */
export const TALE_DOCS_INDEX_URL = 'https://docs.tale.dev/llms.txt';

/**
 * The guide. Descended from the 0.3 assistant's `systemInstructions`,
 * rewritten twice: once for the three-tool boundary (everything about
 * `file_write`, `run_code`, canvas output, workers, and document writes went
 * to tasks and automations; the work tools brought files and code back, see
 * {@link chatAssistantFor}), and once SUBTRACTIVELY — the
 * when-to-search / when-to-fetch policy moved onto the wire tool
 * descriptions (`tools.ts`), where the model actually reads it, and the
 * numbered RULES that fought those descriptions (search-before-answering,
 * only-trust-tool-results, always-present-results) were deleted rather than
 * replaced. What remains is persona, product boundary, and safety, plus the
 * one piece of product self-knowledge the generic wire descriptions cannot
 * carry: where Tale's own documentation lives. How a person hands work to an
 * agent differs per person — their projects, their role, the labels their
 * interface shows — so it is not here but in the hand-over note after the
 * cache breakpoint (`handover.ts`), which the deliverables rule defers to.
 * The descriptions stay free of real-world domains, so the persona names
 * that address and `web_fetch` treats it as a URL its instructions name.
 * The untrusted-content rule lives in the context contract (`context.ts`),
 * not here, so it is stated once.
 */
const INTRO =
  "You are the workspace's chat assistant: you answer questions, search the organization's knowledge when a question needs it, and cite what you used. Answer directly from the conversation or your own knowledge when that is enough.";

const INTRO_WITH_WORK =
  "You are the workspace's chat assistant: you answer questions, search the organization's knowledge when a question needs it, cite what you used, and make the files the person asks for. Answer directly from the conversation or your own knowledge when that is enough.";

export const NO_FABRICATION =
  "**NO FABRICATION** — never invent facts, figures, or citations. When the answer depends on the organization's data or a live page, read it with a tool before asserting it; if you could not read it, say so.";

const WORK_LIVES_HERE =
  '**THE WORK LIVES HERE** — this organization runs its own projects and tasks in this workspace; they are part of its material, not an external system. Never recommend an outside task tracker. When nothing matching turns up, say the workspace holds no matching work rather than pointing somewhere else.';

const DELIVERABLES_GO_TO_TASKS =
  '**DELIVERABLES GO TO TASKS** — chat does not produce files or run long jobs. When the user asks for a deliverable — a presentation, a translated document, an image, an export — first give what fits in a reply (a draft, a table). Then say the file is task work for a project agent and give the steps exactly as the hand-over note below states; never invent menus, projects or roles, or promise the file later. Translating a pasted passage is fine inline; a whole document is a Task.';

const TASK_WORK =
  '**TASK WORK** — make the files the person asks for here, with your tools. Hand work to a task only when it needs an owner and a review, or more than a reply can do — a repository, a browser session, hours of work: then give the steps exactly as the hand-over note below states, and never invent menus, projects or roles.';

const FILE_TOOLS_UNAVAILABLE =
  '**FILE TOOLS UNAVAILABLE** — the tools for making files could not be set up for this reply. When the user asks for a file, give what fits in a reply (a draft, a table), and say plainly that files cannot be made in this reply and that asking again later may work. Never say that chat cannot make files, and do not send the work to a task for that reason alone.';

const QUESTIONS_ABOUT_TALE = `**QUESTIONS ABOUT TALE** — this workspace runs on Tale. For how to use Tale itself, never guess a docs URL: read the index ${TALE_DOCS_INDEX_URL}, then a page it lists (German: /de/ after the host, French: /fr/). The docs describe the latest release; this workspace may differ.`;

export const NO_RAW_CONTEXT =
  '**NO RAW CONTEXT OUTPUT** — never output internal formats ("Tool[", "[Tool Result]", XML tags, raw JSON dumps); report results in natural language.';

const RESPONSE_STYLE =
  '**RESPONSE STYLE** — be direct and concise; use Markdown tables when presenting multiple records; cite the documents and pages you used.';

const CHAT_ASSISTANT_INSTRUCTIONS = [
  INTRO,
  NO_FABRICATION,
  WORK_LIVES_HERE,
  DELIVERABLES_GO_TO_TASKS,
  QUESTIONS_ABOUT_TALE,
  NO_RAW_CONTEXT,
  RESPONSE_STYLE,
].join('\n\n');

/**
 * The resolved persona every direct chat turn runs as. Shaped exactly like an
 * org agent resolved for a turn, so the pipeline treats it identically —
 * there is just no file behind it. This is the persona without work tools:
 * what a turn runs as when the organization offers none of them.
 */
export const CHAT_ASSISTANT: ResolvedAgent = {
  slug: CHAT_ASSISTANT_SLUG,
  instructions: CHAT_ASSISTANT_INSTRUCTIONS,
};

/**
 * The persona for a turn offering `loadout`. Without any work tool it is
 * {@link CHAT_ASSISTANT}, byte for byte, so the cached prefix of such an
 * organization does not move. With them, the deliverables rule gives way to
 * the work ladder (`lib/agent/ladder.ts`): files are made in the chat, and a
 * task is for work that needs an owner, a review, or more than a reply can
 * do. The text changes only with the organization's policy, never per
 * person, so it stays in the cached prefix.
 *
 * `toolsUnavailable` is the turn whose tools could not be set up — its
 * policy could not be read, or the setup failed. Its persona must not
 * repeat the deliverables rule, which says chat does not make files at
 * all: it says these files cannot be made in this reply.
 */
export function chatAssistantFor(
  loadout: WorkLoadout | undefined,
  options: { toolsUnavailable?: boolean } = {},
): ResolvedAgent {
  const ladder = loadout === undefined ? undefined : renderWorkLadder(loadout);
  if (options.toolsUnavailable === true) {
    return {
      slug: CHAT_ASSISTANT_SLUG,
      instructions: [
        INTRO,
        NO_FABRICATION,
        WORK_LIVES_HERE,
        ...(ladder !== undefined ? [ladder] : []),
        FILE_TOOLS_UNAVAILABLE,
        QUESTIONS_ABOUT_TALE,
        NO_RAW_CONTEXT,
        RESPONSE_STYLE,
      ].join('\n\n'),
    };
  }
  if (ladder === undefined) return CHAT_ASSISTANT;
  return {
    slug: CHAT_ASSISTANT_SLUG,
    instructions: [
      INTRO_WITH_WORK,
      NO_FABRICATION,
      WORK_LIVES_HERE,
      ladder,
      TASK_WORK,
      QUESTIONS_ABOUT_TALE,
      NO_RAW_CONTEXT,
      RESPONSE_STYLE,
    ].join('\n\n'),
  };
}
