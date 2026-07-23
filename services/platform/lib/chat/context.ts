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
 *  6. Full message history: tool messages, approval and human-input cards, and
 *     attachments as content parts
 *
 * On overflow the OLDEST messages are dropped and a visible notice takes their
 * place. There is deliberately NO LLM compaction: a summarizer is a second
 * model call that can hallucinate the conversation it is supposed to preserve,
 * and its failure mode — confidently wrong history — is invisible to the user.
 * Dropping messages is lossy in a way everyone can see.
 *
 * Deliberately NOT assembled here, each removed on purpose: a personalization
 * blob, auto-injected memories, auto-retrieved knowledge, auto web context,
 * a todos prompt augmentation, a branding section, a skills suffix, a tuning
 * suffix, routing metadata, and an artifacts section. Everything the model
 * learns beyond its instructions, it learns by CALLING something — which is
 * visible in the transcript, attributable, and refusable.
 *
 * Layer A: pure, no `node:*`, no Convex, no model call.
 */

import { UNTRUSTED_CONTENT_SYSTEM_PROMPT } from '../../convex/lib/untrusted_content';
import { narrowBcp47 } from '../shared/utils/narrow-bcp47';
import { pickField } from '../shared/utils/pick-field';
import { estimateTokens, messageText, type ChatMessage } from './types';

/** The canonical block order. The assembler emits a subsequence of this list
 * — never a reordering, never an extra. */
export const CONTEXT_BLOCK_ORDER = [
  'mandatory-instructions',
  'agent-instructions',
  'untrusted-content-rules',
  'tool-docs',
  'cache-breakpoint',
  'runtime-directives',
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
  readonly toolDocs?: readonly ToolDoc[];
  /** The turn's wall clock, injected so assembly is deterministic in tests. */
  readonly now: Date;
  readonly history: readonly ChatMessage[];
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
  /** Block 5 rendered — the part that changes every turn. */
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
    ...lines,
  ].join('\n');
}

function renderRuntimeDirectives(now: Date, locale: string): string {
  return [
    `Current time: ${now.toISOString()} (UTC).`,
    `Respond in the user's language (${locale}). If the user writes in another language, answer in the language they used.`,
  ].join('\n');
}

/** The notice that replaces dropped messages. Phrased as a fact about the
 * transcript so the model neither invents the missing turns nor apologizes
 * for them. */
export function truncationNotice(droppedMessages: number): string {
  return `[${droppedMessages} earlier message${droppedMessages === 1 ? '' : 's'} removed to fit the context window. They were dropped, not summarized — ask the user if you need something from earlier in the conversation.]`;
}

function noticeMessage(droppedMessages: number): ChatMessage {
  return {
    role: 'system',
    parts: [{ type: 'text', text: truncationNotice(droppedMessages) }],
  };
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
  history: readonly ChatMessage[],
  available: number,
): { messages: readonly ChatMessage[]; truncation?: ContextTruncation } {
  const costs = history.map((message) => estimateTokens(messageText(message)));
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  if (total <= available || history.length === 0) return { messages: history };

  // The notice costs tokens too, so it is part of the budget from the start.
  // Sized against the largest count it could name, which over-estimates by a
  // character or two — cheaper than re-deriving the cost on every iteration.
  const noticeCost = estimateTokens(truncationNotice(history.length));
  let dropped = 0;
  let remaining = total;
  while (dropped < history.length - 1 && remaining + noticeCost > available) {
    remaining -= costs[dropped] ?? 0;
    dropped += 1;
  }
  if (dropped === 0) return { messages: history };

  const kept = history.slice(dropped);
  return {
    messages: [noticeMessage(dropped), ...kept],
    truncation: { droppedMessages: dropped, notice: truncationNotice(dropped) },
  };
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

  const cacheBreakpointIndex = blocks.length;
  blocks.push({ id: 'cache-breakpoint' });

  const volatileSuffix = renderRuntimeDirectives(input.now, input.locale);
  blocks.push({ id: 'runtime-directives', text: volatileSuffix });

  const stablePrefix = blocks
    .slice(0, cacheBreakpointIndex)
    .map((block) => ('text' in block ? block.text : ''))
    .filter((text) => text.length > 0)
    .join(BLOCK_SEPARATOR);
  const system = [stablePrefix, volatileSuffix]
    .filter((part) => part.length > 0)
    .join(BLOCK_SEPARATOR);

  const reserve = input.budget.reserveOutputTokens ?? 0;
  const available = Math.max(
    0,
    input.budget.maxTokens - reserve - estimateTokens(system),
  );
  const { messages, truncation } = fitHistory(input.history, available);
  blocks.push({ id: 'message-history', messages });

  const estimatedTokens =
    estimateTokens(system) +
    messages.reduce(
      (sum, message) => sum + estimateTokens(messageText(message)),
      0,
    );

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
