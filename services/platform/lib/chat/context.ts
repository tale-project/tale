/**
 * The context contract — exactly what the model gets, in exactly one order.
 *
 * The order is not cosmetic. Blocks 1–4 are the STABLE PREFIX: identical for
 * every turn of every conversation with the same agent, which is what lets a
 * provider serve them from its prompt cache. Everything that changes per turn
 * — the clock, the language directive, the conversation itself — lives after
 * the cache breakpoint. Moving one byte above the breakpoint invalidates the
 * cache for every user of that agent, so the order is fixed here and asserted
 * by tests rather than left to each caller.
 *
 *  1. Org mandatory instructions (skipped for sub-agent turns — a sub-agent is
 *     already running inside a turn that applied them, and re-applying them
 *     would let a nested call double the org's voice)
 *  2. Agent instructions, i18n-resolved
 *  3. Untrusted-content rules
 *  4. Tool docs — one short line each; the schemas ride the tool definitions
 *     rather than being pasted into the prompt
 *  — cache breakpoint —
 *  5. Timestamp + response-language directive
 *  6. The person's own standing instructions (Settings > Preferences), when
 *     their toggle has them on — per person, so they can never join the
 *     prefix that is shared by every user of the agent
 *  7. Full message history: tool messages, approval and human-input cards, and
 *     attachments as content parts
 *
 * On overflow the OLDEST messages are dropped and a visible notice takes their
 * place. There is deliberately NO LLM compaction: a summarizer is a second
 * model call that can hallucinate the conversation it is supposed to preserve,
 * and its failure mode — confidently wrong history — is invisible to the user.
 * Dropping messages is lossy in a way everyone can see.
 *
 * Deliberately NOT assembled here, each removed on purpose: auto-injected
 * memories, auto-retrieved knowledge, auto web context, a todos prompt
 * augmentation, a branding section, a skills suffix, a tuning suffix, routing
 * metadata, and an artifacts section. Everything the model learns beyond its
 * instructions, it learns by CALLING something — which is visible in the
 * transcript, attributable, and refusable. The person's custom instructions
 * are instructions, not learned content: they are the one per-person block,
 * and the host resolves the person's toggle before they get here.
 *
 * Layer A: pure, no `node:*`, no Convex, no model call.
 */

import { boundJson } from '../shared/utils/bound-json';
import { languageDisplayName } from '../shared/utils/language-name';
import { narrowBcp47 } from '../shared/utils/narrow-bcp47';
import { pickField } from '../shared/utils/pick-field';
import {
  estimateMessageTokens,
  estimateTokens,
  type ChatMessage,
  type MessagePart,
} from './types';
import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from './untrusted-content';

/** The canonical block order. The assembler emits a subsequence of this list
 * — never a reordering, never an extra. */
export const CONTEXT_BLOCK_ORDER = [
  'mandatory-instructions',
  'agent-instructions',
  'untrusted-content-rules',
  'tool-docs',
  // Inside the cached stable prefix: a thread's project never changes, so
  // re-sending it per turn would break the prefix for no gain.
  'project-context',
  'cache-breakpoint',
  'runtime-directives',
  // After the breakpoint on purpose: the block is per person, and the prefix
  // above must stay byte-identical for every user of the agent.
  'custom-instructions',
  'message-history',
] as const;

export type ContextBlockId = (typeof CONTEXT_BLOCK_ORDER)[number];

/** A block that renders into the system prompt. */
export type TextBlockId = Exclude<
  ContextBlockId,
  'cache-breakpoint' | 'message-history'
>;

export type ContextBlock =
  | { readonly id: TextBlockId; readonly text: string }
  | { readonly id: 'cache-breakpoint' }
  | {
      readonly id: 'message-history';
      readonly messages: readonly ChatMessage[];
    };

/** One line of tool documentation. Schemas are NOT included — they travel with
 * the tool definitions the provider already receives. */
export interface ToolDoc {
  readonly id: string;
  readonly description: string;
}

/** The agent's own instructions, with optional per-locale overrides. */
export interface AgentInstructions {
  readonly slug: string;
  readonly instructions?: string;
  readonly i18n?: Readonly<
    Record<string, { readonly instructions?: string } | undefined>
  >;
}

export interface ContextBudget {
  /** The model's context window, in tokens. */
  readonly maxTokens: number;
  /** Held back for the answer; the history is fitted into what remains. */
  readonly reserveOutputTokens?: number;
}

/** What a project contributes to a turn's prompt. */
export interface ProjectContext {
  readonly name: string;
  /** The project key (`WR` in `WR-12`) — the handle people and task ids use
   * for it, so the assistant can recognise it when a message says it. */
  readonly key?: string;
  /** The project's own standing instructions — the field the editor promises
   * "every chat in this project starts with these instructions". */
  readonly instructions?: string;
}

export interface ContextInput {
  readonly organizationId: string;
  /** The org's one mandatory-instructions field, already resolved from the
   * governance policy. */
  readonly mandatoryInstructions?: string;
  /** A sub-agent turn runs inside a turn that already applied the org's
   * instructions, so block 1 is skipped. */
  readonly isSubAgentTurn?: boolean;
  readonly agent?: AgentInstructions;
  /** The user's locale, for the response-language directive and for resolving
   * the agent's localized instructions. */
  readonly locale: string;
  /** The caller FIXED the reply language: the assistant answers in `locale`
   * whatever language the user writes in — the REST send that named
   * `locale`. Absent, the user's own language wins, which is what the app
   * lane wants from a `locale` that is only the UI's setting. */
  readonly localeFixed?: boolean;
  readonly toolDocs?: readonly ToolDoc[];
  /**
   * The project a project-bound thread belongs to — the scope boundary of
   * the turn: the model is told which project the conversation sits in, that
   * its tools reach this project's files and the organization's shared
   * knowledge and no other project's, and what the project asks of it. The
   * boundary itself is enforced server-side in the tool executor; this block
   * tells the model so it never goes looking for what it cannot reach.
   * Absent for an unbound thread.
   */
  readonly project?: ProjectContext;
  /**
   * The person's own standing instructions (Settings > Preferences), already
   * resolved by the host through their toggle over the org default — absent
   * while the feature is off for them or the text is blank. Per person, so
   * the block rides AFTER the cache breakpoint: the cached prefix stays
   * identical for every user of the agent. Skipped on a sub-agent turn, the
   * way the org's instructions are.
   */
  readonly customInstructions?: string;
  /** The turn's wall clock, injected so assembly is deterministic in tests. */
  readonly now: Date;
  readonly history: readonly ChatMessage[];
  /** Turns already omitted BEFORE assembly (the bounded DB read stops at a
   * budget) — folded into the truncation notice so the model hears the true
   * count. */
  readonly historyOmittedCount?: number;
  readonly budget: ContextBudget;
}

export interface ContextTruncation {
  readonly droppedMessages: number;
  /** The notice inserted in their place — visible in the transcript, not a
   * silent gap. */
  readonly notice: string;
}

export interface AssembledContext {
  /** Every emitted block, in canonical order. */
  readonly blocks: readonly ContextBlock[];
  /** Index of the cache breakpoint within {@link blocks}. */
  readonly cacheBreakpointIndex: number;
  /** Blocks 1–4 rendered — the part a provider may cache. */
  readonly stablePrefix: string;
  /** The blocks after the breakpoint rendered — the clock and language
   * directives, then the person's custom instructions when they have any.
   * Re-sent every turn. */
  readonly volatileSuffix: string;
  /** The full system prompt: stable prefix, then volatile suffix. */
  readonly system: string;
  /** The history as it will be sent, after any truncation. */
  readonly messages: readonly ChatMessage[];
  readonly truncation?: ContextTruncation;
  /** Estimated prompt size, for the usage ledger and the message-info panel. */
  readonly estimatedTokens: number;
}

const BLOCK_SEPARATOR = '\n\n';

/**
 * Resolve the agent's instructions for `locale`: the exact locale wins, then
 * its base language (`de-CH` → `de`), then the authored English, then the
 * top-level field. Same precedence the provider and prompt resolvers use, so
 * an org sees one localization rule everywhere.
 */
export function resolveAgentInstructions(
  agent: AgentInstructions,
  locale: string,
): string | undefined {
  const base = narrowBcp47(locale);
  return pickField([
    agent.i18n?.[locale]?.instructions,
    base ? agent.i18n?.[base]?.instructions : undefined,
    agent.i18n?.en?.instructions,
    agent.instructions,
  ]);
}

function renderToolDocs(docs: readonly ToolDoc[]): string {
  const lines = docs.map((doc) => `- ${doc.id}: ${doc.description}`);
  return [
    'AVAILABLE CAPABILITIES',
    'Call one to act or to look something up. Argument schemas travel with the tool definitions — ask for what you need rather than guessing at a shape.',
    'Lookups are budgeted per reply: you get a few tool rounds, and a round runs all its calls in parallel — issue independent searches and fetches together in one round rather than one at a time.',
    ...lines,
  ].join('\n');
}

function renderRuntimeDirectives(
  now: Date,
  locale: string,
  localeFixed: boolean,
): string {
  return [
    `Current time: ${now.toISOString()} (UTC).`,
    localeFixed
      ? fixedReplyLanguageDirective(locale)
      : `Respond in the user's language (${locale}). If the user writes in another language, answer in the language they used.`,
  ].join('\n');
}

/**
 * The directive for a caller-fixed reply language names the language in
 * words. The raw tag alone ("Answer in de …") read as an abbreviation a
 * reasoning model on a short prompt weighted weakly — it answered in the
 * prompt's language anyway. The tag rides beside the name, so a tag the
 * runtime cannot name still says what it is. The system prompt is one of
 * the two places the directive sits: the turn pipeline also appends a
 * wire-only notice to the newest user message (`fixedLocaleNotice`).
 */
function fixedReplyLanguageDirective(locale: string): string {
  const name = languageDisplayName(locale);
  return `Reply language: ${name} (${locale}). Write the whole reply in ${name}, whatever language the user writes in — the caller fixed the reply language; do not switch to the user's language.`;
}

/** The notice that replaces dropped messages. Phrased as a fact about the
 * transcript so the model neither invents the missing turns nor apologizes
 * for them. */
export function truncationNotice(droppedMessages: number): string {
  return `[${droppedMessages} earlier message${droppedMessages === 1 ? '' : 's'} removed to fit the context window. They were dropped, not summarized — ask the user if you need something from earlier in the conversation.]`;
}

function noticeMessage(droppedMessages: number): ChatMessage {
  return {
    // Role USER, not system: the Anthropic wire format hoists every
    // system-role message into the system prompt, which would tear the
    // notice out of the position its own wording depends on ("earlier in
    // the conversation"). As a user turn it keeps its place on every format.
    role: 'user',
    parts: [{ type: 'text', text: truncationNotice(droppedMessages) }],
  };
}

/**
 * The protected tail: the newest turns are never dropped, whatever they
 * cost. Mirrors the automations engine's window discipline — losing the
 * immediate back-and-forth is worse than over-shooting the budget, and a
 * grossly over-long tail is better refused by the provider with its real
 * error than swallowed here.
 */
const KEEP_RECENT_MESSAGES = 4;

/** Bounds for deep-truncating tool payloads before they are sized or sent. */
const TOOL_RESULT_MAX_STRING = 400;
const TOOL_RESULT_MAX_ITEMS = 12;
const TOOL_RESULT_MAX_DEPTH = 8;

/**
 * Deep-truncate a tool result so one verbose payload cannot flood the
 * window: long strings are cut with a count marker, arrays capped, deep
 * nesting elided. The seam for the tool loop — text a USER wrote is never
 * rewritten (dropping whole old messages is honest; silently editing the
 * user's words is not).
 */
function boundToolResult(value: unknown, depth = 0): unknown {
  return boundJson(
    value,
    {
      maxString: TOOL_RESULT_MAX_STRING,
      maxItems: TOOL_RESULT_MAX_ITEMS,
      maxDepth: TOOL_RESULT_MAX_DEPTH,
    },
    depth,
  );
}

/** Apply the tool-result bound to a message's parts, leaving every other
 * part untouched. Returns the same reference when nothing changed. */
function boundMessage(message: ChatMessage): ChatMessage {
  let changed = false;
  const parts: MessagePart[] = message.parts.map((part) => {
    if (part.type !== 'tool-result') return part;
    const bounded = boundToolResult(part.output);
    if (bounded === part.output) return part;
    changed = true;
    return { ...part, output: bounded };
  });
  return changed ? { ...message, parts } : message;
}

/**
 * Fit `history` into `available` tokens by dropping the OLDEST messages and
 * inserting a notice in their place.
 *
 * The newest message is never dropped: a turn that sent nothing but a notice
 * would be a silent failure, and a single over-long message is better refused
 * by the provider — with its real error — than swallowed here.
 */
function fitHistory(
  rawHistory: readonly ChatMessage[],
  available: number,
  alreadyOmitted = 0,
): { messages: readonly ChatMessage[]; truncation?: ContextTruncation } {
  const history = rawHistory.map(boundMessage);
  const costs = history.map(estimateMessageTokens);
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  if (total <= available || history.length === 0) {
    // Nothing dropped HERE — but a bounded read may have cut older turns
    // before assembly ever saw them; the notice still owes the model that.
    if (alreadyOmitted > 0) {
      return {
        messages: [noticeMessage(alreadyOmitted), ...history],
        truncation: {
          droppedMessages: alreadyOmitted,
          notice: truncationNotice(alreadyOmitted),
        },
      };
    }
    return { messages: history };
  }

  // The notice costs tokens too, so it is part of the budget from the start.
  // Sized against the largest count it could name, which over-estimates by a
  // character or two — cheaper than re-deriving the cost on every iteration.
  const noticeCost = estimateTokens(truncationNotice(history.length));
  let protectedTail = Math.min(KEEP_RECENT_MESSAGES, history.length);
  let dropped = 0;
  let remaining = total;
  while (
    dropped < history.length - protectedTail &&
    remaining + noticeCost > available
  ) {
    remaining -= costs[dropped] ?? 0;
    dropped += 1;
  }
  // Degrade gracefully: when the protected tail alone still busts the
  // budget, release it oldest-first down to the single newest message — a
  // turn that keeps only the newest exchange still beats one the provider
  // rejects outright.
  while (remaining + noticeCost > available && protectedTail > 1) {
    remaining -= costs[dropped] ?? 0;
    dropped += 1;
    protectedTail -= 1;
  }
  if (dropped === 0 && alreadyOmitted === 0) return { messages: history };

  const kept = history.slice(dropped);
  const totalDropped = dropped + alreadyOmitted;
  return {
    messages: [noticeMessage(totalDropped), ...kept],
    truncation: {
      droppedMessages: totalDropped,
      notice: truncationNotice(totalDropped),
    },
  };
}

/**
 * The project block: which project this conversation belongs to, what its
 * tools reach from here, and the project's standing instructions when it has
 * any.
 *
 * The boundary sentence states what the executor enforces: a project chat's
 * tools reach the project's files plus the organization's shared knowledge,
 * and no other project. Said in the prompt so the model neither walks the
 * project list to find "the project's files" nor apologises for a boundary
 * that is the product's design.
 */
function renderProjectContext(project?: ProjectContext): string | undefined {
  const name = project?.name.trim();
  if (!name) return undefined;
  const key = project?.key?.trim();
  const instructions = project?.instructions?.trim();
  const lines = [
    `This conversation belongs to project "${name}"${key ? ` (${key})` : ''}. ` +
      "Your tools reach this project's files and the organization's shared " +
      'knowledge; other projects are out of scope in this chat.',
  ];
  if (instructions) {
    lines.push('', `Instructions for this project:`, instructions);
  }
  return lines.join('\n');
}

/**
 * The person's standing instructions, framed so the model knows whose voice
 * they are and where they rank: the org's mandatory instructions and the
 * project's instructions sit above them in the prompt and win a conflict.
 * Absent for blank text — an empty header would be a block saying nothing.
 */
const CUSTOM_INSTRUCTIONS_HEADER =
  'Standing instructions from the person you are talking to — their own ' +
  'preferences for how you reply to them. Follow them. Where they conflict ' +
  "with the organization's or the project's instructions above, those take " +
  'precedence.';

function renderCustomInstructions(text?: string): string | undefined {
  const instructions = text?.trim();
  if (!instructions) return undefined;
  return `${CUSTOM_INSTRUCTIONS_HEADER}\n\n${instructions}`;
}

/**
 * Assemble the context for one turn. Pure: same input, same prompt — no clock
 * read, no model call, no I/O.
 */

export function assembleContext(input: ContextInput): AssembledContext {
  const blocks: ContextBlock[] = [];

  const mandatory = input.isSubAgentTurn
    ? undefined
    : input.mandatoryInstructions?.trim();
  if (mandatory) {
    blocks.push({ id: 'mandatory-instructions', text: mandatory });
  }

  const agentInstructions = input.agent
    ? resolveAgentInstructions(input.agent, input.locale)?.trim()
    : undefined;
  if (agentInstructions) {
    blocks.push({ id: 'agent-instructions', text: agentInstructions });
  }

  blocks.push({
    id: 'untrusted-content-rules',
    text: UNTRUSTED_CONTENT_SYSTEM_PROMPT,
  });

  const toolDocs = input.toolDocs ?? [];
  if (toolDocs.length > 0) {
    blocks.push({ id: 'tool-docs', text: renderToolDocs(toolDocs) });
  }

  // BEFORE the cache breakpoint, so it joins the stable prefix: a project-bound
  // thread's project never changes mid-thread, and putting it in the volatile
  // suffix would re-send it every turn and break the cached prefix for nothing.
  const projectBlock = renderProjectContext(input.project);
  if (projectBlock) {
    blocks.push({ id: 'project-context', text: projectBlock });
  }

  const cacheBreakpointIndex = blocks.length;
  blocks.push({ id: 'cache-breakpoint' });

  const runtimeDirectives = renderRuntimeDirectives(
    input.now,
    input.locale,
    input.localeFixed === true,
  );
  blocks.push({ id: 'runtime-directives', text: runtimeDirectives });

  // AFTER the breakpoint on purpose: the block is per person, and the prefix
  // above must stay byte-identical for every user of the agent to be served
  // from the provider's cache. The suffix is re-sent every turn regardless
  // (the clock changes), so the block costs its own tokens and nothing more.
  const customInstructions = input.isSubAgentTurn
    ? undefined
    : renderCustomInstructions(input.customInstructions);
  if (customInstructions) {
    blocks.push({ id: 'custom-instructions', text: customInstructions });
  }

  const volatileSuffix = [runtimeDirectives, customInstructions]
    .filter((text): text is string => text !== undefined && text.length > 0)
    .join(BLOCK_SEPARATOR);

  const stablePrefix = blocks
    .slice(0, cacheBreakpointIndex)
    .map((block) => ('text' in block ? block.text : ''))
    .filter((text) => text.length > 0)
    .join(BLOCK_SEPARATOR);
  const system = [stablePrefix, volatileSuffix]
    .filter((part) => part.length > 0)
    .join(BLOCK_SEPARATOR);

  const reserve = input.budget.reserveOutputTokens ?? 0;
  // The history's slice: whatever the effective window leaves after the
  // output reserve and the system prompt. The window (model declaration,
  // shrunk by governance) is the only ceiling — a flat cap here would
  // silently waste capability the catalog declared.
  const available = Math.max(
    0,
    input.budget.maxTokens - reserve - estimateTokens(system),
  );
  const { messages, truncation } = fitHistory(
    input.history,
    available,
    input.historyOmittedCount ?? 0,
  );
  blocks.push({ id: 'message-history', messages });

  const estimatedTokens =
    estimateTokens(system) +
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

  return {
    blocks,
    cacheBreakpointIndex,
    stablePrefix,
    volatileSuffix,
    system,
    messages,
    truncation,
    estimatedTokens,
  };
}
