/**
 * The reply plan: everything about one chat answer decided up front, apart
 * from the wire it travels on.
 *
 * Both dialects (OpenAI Chat Completions and Anthropic Messages) normalize
 * their request into a `ChatTurnInput`, ask `planReply` what to answer, and
 * only render the plan — so latency, length, reasoning, tool calls, caching
 * and faults behave identically whichever dialect a deployment speaks, and
 * the usage a stream reports is computed from exactly the text it carries.
 */

import type { MockOptions } from './config.ts';
import {
  detectLocale,
  type ContentLocale,
  generateReasoning,
  generateReply,
  generateSentence,
  generateTitle,
  keywordsOf,
  toolIntro,
  toolResultLead,
} from './content.ts';
import {
  parseDirectives,
  sampleFault,
  stripDirectives,
  type Dialect,
  type Fault,
  type MockDirectives,
} from './faults.ts';
import { maxOutputTokensOf, modelSupportsReasoning } from './models.ts';
import type { PromptCache } from './prompt-cache.ts';
import {
  chance,
  clamp,
  lognormalFromMedianP95,
  normal,
  randomId,
  type Random,
} from './random.ts';
import { estimateTokens, truncateToTokens } from './tokens.ts';
import {
  chooseTool,
  generateToolArguments,
  valueForSchema,
  type OfferedTool,
} from './tool-args.ts';

export type ToolChoice =
  | { readonly kind: 'auto' }
  | { readonly kind: 'none' }
  | { readonly kind: 'required' }
  | { readonly kind: 'named'; readonly name: string };

export type ResponseFormat =
  | { readonly kind: 'text' }
  | { readonly kind: 'json_object' }
  | { readonly kind: 'json_schema'; readonly schema: unknown };

/** A chat request, whatever dialect it arrived in. */
export interface ChatTurnInput {
  readonly dialect: Dialect;
  readonly model: string;
  readonly stream: boolean;
  /** The request's reply ceiling (`max_tokens`, `max_completion_tokens`). */
  readonly maxTokens: number | undefined;
  /** Every system instruction, joined. */
  readonly systemText: string;
  /** The text of the last user message that has text. */
  readonly lastUserText: string;
  /** The tool result the transcript ends on, when it ends on one. */
  readonly toolResult: {
    readonly toolName: string;
    readonly content: string;
  } | null;
  readonly tools: readonly OfferedTool[];
  readonly toolChoice: ToolChoice;
  /** The requested reasoning level; null when the request asked for none. */
  readonly reasoningEffort: string | null;
  /** Anthropic's thinking budget, when the request set one. */
  readonly reasoningBudget: number | undefined;
  readonly responseFormat: ResponseFormat;
  /** Whether a prompt-cache hit may be reported for this request. */
  readonly promptCaching: boolean;
  readonly promptTokens: number;
  /** Rolling prefix hashes, one per message (see `PrefixHasher`). */
  readonly prefixHashes: readonly string[];
  /** Prompt tokens up to and including each message. */
  readonly prefixTokens: readonly number[];
}

export type FinishReason = 'stop' | 'length' | 'tool_calls';

export interface PlannedToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  readonly argumentsTokens: number;
}

export interface ReplyPlan {
  readonly kind: 'title' | 'reply' | 'tool';
  readonly fault: Fault;
  readonly ttftMs: number;
  readonly tokensPerSecond: number;
  readonly reasoning: string;
  readonly reasoningTokens: number;
  readonly content: string;
  readonly contentTokens: number;
  readonly toolCall: PlannedToolCall | null;
  readonly finish: FinishReason;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  /** Reasoning + content + tool-call argument tokens. */
  readonly completionTokens: number;
}

/** Prefill cost of uncached prompt tokens, added to the time to first token. */
const PREFILL_MS_PER_1K_TOKENS = 8;
/** Bounds of a sampled time to first token. */
const TTFT_MIN_MS = 5;
const TTFT_MAX_MS = 120_000;
/** Bounds of a sampled reply length. */
const REPLY_TOKENS_MAX = 32_768;
/** A request with a ceiling this low and no stream is a title-sized call. */
const TITLE_CALL_MAX_TOKENS = 64;
/** The least reasoning a reasoning reply spends. */
const REASONING_MIN_TOKENS = 16;

/** Reasoning spend per effort level, relative to `medium`. */
const EFFORT_FACTORS: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 0.25,
  low: 0.5,
  medium: 1,
  high: 2,
  xhigh: 3,
  max: 3,
};

const NO_DIRECTIVES: MockDirectives = {};

/**
 * Whether the request is the platform's thread-title call: its system
 * prompt opens with "You are a title generator", or it is a small
 * non-streaming call with a title-sized ceiling and no tools.
 */
function isTitleRequest(input: ChatTurnInput): boolean {
  if (/^\s*you are a title generator/i.test(input.systemText)) return true;
  return (
    !input.stream &&
    input.maxTokens !== undefined &&
    input.maxTokens <= TITLE_CALL_MAX_TOKENS &&
    input.tools.length === 0
  );
}

function shouldCallTool(
  random: Random,
  input: ChatTurnInput,
  directives: MockDirectives,
  toolCallRate: number,
): OfferedTool | null {
  if (input.tools.length === 0 || input.toolChoice.kind === 'none') return null;
  if (directives.tool === false) return null;
  const choice = input.toolChoice;
  if (choice.kind === 'named') {
    return input.tools.find((tool) => tool.name === choice.name) ?? null;
  }
  if (choice.kind === 'required') return chooseTool(random, input.tools, true);
  // A model answers a tool result in prose; only an explicit ask calls
  // again, so a forced call never loops.
  if (input.toolResult !== null) return null;
  if (directives.tool === true) return chooseTool(random, input.tools, true);
  return chance(random, toolCallRate)
    ? chooseTool(random, input.tools, false)
    : null;
}

function jsonContent(
  random: Random,
  format: ResponseFormat,
  hints: { keywords: readonly string[]; locale: string },
  locale: ContentLocale,
): string {
  if (format.kind === 'json_schema') {
    return JSON.stringify(
      valueForSchema(random, format.schema, 'result', hints),
    );
  }
  return JSON.stringify({ answer: generateSentence(random, locale) });
}

/** Decide the whole answer to one chat request. */
export function planReply(
  random: Random,
  input: ChatTurnInput,
  options: MockOptions,
  cache: PromptCache,
): ReplyPlan {
  const title = isTitleRequest(input);
  // Directives address the conversation's turn; the title call that names
  // the same first message must not inherit its faults or its shape.
  const directives = title
    ? NO_DIRECTIVES
    : parseDirectives(input.lastUserText, options.stallMs);
  let fault = sampleFault(random, options, directives);
  if (!input.stream && fault.kind === 'midstream') {
    // A buffered answer cannot fail halfway; it fails as a whole.
    fault = { kind: 'http', status: 500 };
  }

  const cachedTokens = input.promptCaching
    ? cache.lookupAndRemember(input.prefixHashes, input.prefixTokens)
    : 0;
  const uncached = Math.max(0, input.promptTokens - cachedTokens);
  const ttftMs =
    directives.ttftMs ??
    clamp(
      lognormalFromMedianP95(random, options.ttftMedianMs, options.ttftP95Ms) +
        (uncached / 1000) * PREFILL_MS_PER_1K_TOKENS,
      Math.min(TTFT_MIN_MS, options.ttftMedianMs),
      TTFT_MAX_MS,
    );
  const tokensPerSecond = Math.max(
    1,
    normal(random, options.tokensPerSecondMean, options.tokensPerSecondSd),
    options.tokensPerSecondMean * 0.2,
  );
  const cap = input.maxTokens ?? maxOutputTokensOf(input.model);

  const base = {
    fault,
    ttftMs,
    tokensPerSecond,
    promptTokens: input.promptTokens,
    cachedTokens,
  };

  const userText = stripDirectives(input.lastUserText);
  const locale = detectLocale(userText);

  if (title) {
    let content = generateTitle(random, userText, locale);
    let contentTokens = estimateTokens(content);
    let finish: FinishReason = 'stop';
    if (contentTokens > cap) {
      content = truncateToTokens(content, cap);
      contentTokens = estimateTokens(content);
      finish = 'length';
    }
    return {
      ...base,
      kind: 'title',
      reasoning: '',
      reasoningTokens: 0,
      content,
      contentTokens,
      toolCall: null,
      finish,
      completionTokens: contentTokens,
    };
  }

  const keywords = keywordsOf(userText, 6);
  const hints = { keywords, locale };
  const target =
    directives.tokens ??
    Math.round(
      clamp(
        lognormalFromMedianP95(
          random,
          options.replyTokensMedian,
          options.replyTokensP95,
        ),
        1,
        REPLY_TOKENS_MAX,
      ),
    );

  // Reasoning first: it is spent before a word of the answer.
  let reasoning = '';
  const effort = input.reasoningEffort;
  const factor = effort === null ? 0 : (EFFORT_FACTORS[effort] ?? 1);
  if (factor > 0 && modelSupportsReasoning(input.model)) {
    let wanted = Math.max(
      REASONING_MIN_TOKENS,
      Math.round(target * options.reasoningTokensRatio * factor),
    );
    if (input.reasoningBudget !== undefined) {
      wanted = Math.min(wanted, input.reasoningBudget);
    }
    if (options.reasoningTokensRatio > 0 && wanted > 0) {
      reasoning = truncateToTokens(
        generateReasoning(random, keywords.slice(0, 3).join(' '), wanted),
        wanted,
      );
    }
  }
  let reasoningTokens = estimateTokens(reasoning);

  const tool =
    directives.empty === true
      ? null
      : shouldCallTool(random, input, directives, options.toolCallRate);
  let toolCall: PlannedToolCall | null = null;
  let content: string;
  if (directives.empty === true) {
    content = '';
  } else if (tool !== null) {
    content = toolIntro(random, locale);
    const argumentsJson = JSON.stringify(
      generateToolArguments(random, tool.parameters, hints),
    );
    toolCall = {
      id:
        input.dialect === 'anthropic'
          ? `toolu_01${randomId(random, 22)}`
          : `call_${randomId(random, 24)}`,
      name: tool.name,
      argumentsJson,
      argumentsTokens: estimateTokens(argumentsJson),
    };
  } else if (input.responseFormat.kind !== 'text') {
    content = jsonContent(random, input.responseFormat, hints, locale);
  } else {
    const lead =
      input.toolResult === null
        ? undefined
        : toolResultLead(
            locale,
            input.toolResult.toolName,
            input.toolResult.content,
          );
    content = generateReply(random, {
      locale,
      targetTokens: target,
      ...(lead !== undefined ? { lead } : {}),
    });
    if (directives.tokens !== undefined) {
      content = truncateToTokens(content, directives.tokens);
    }
  }
  let contentTokens = estimateTokens(content);

  // The ceiling covers reasoning, text and tool arguments together.
  let finish: FinishReason = toolCall === null ? 'stop' : 'tool_calls';
  if (reasoningTokens >= cap) {
    reasoning = truncateToTokens(reasoning, cap);
    reasoningTokens = estimateTokens(reasoning);
    content = '';
    contentTokens = 0;
    toolCall = null;
    finish = 'length';
  } else {
    const room = cap - reasoningTokens;
    const needed = contentTokens + (toolCall?.argumentsTokens ?? 0);
    if (needed > room) {
      // A call whose arguments do not fit is cut off as plain text.
      toolCall = null;
      content = truncateToTokens(content, room);
      contentTokens = estimateTokens(content);
      finish = 'length';
    }
  }

  return {
    ...base,
    kind: toolCall === null ? 'reply' : 'tool',
    reasoning,
    reasoningTokens,
    content,
    contentTokens,
    toolCall,
    finish,
    completionTokens:
      reasoningTokens + contentTokens + (toolCall?.argumentsTokens ?? 0),
  };
}

/** How long a buffered (non-streaming) answer takes to arrive. */
export function bufferedLatencyMs(plan: ReplyPlan): number {
  const stall = plan.fault.kind === 'stall' ? plan.fault.ms : 0;
  return (
    plan.ttftMs + (plan.completionTokens / plan.tokensPerSecond) * 1000 + stall
  );
}
