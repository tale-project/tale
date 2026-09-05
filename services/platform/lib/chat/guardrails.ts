/**
 * The guardrail chain — `chat_filter → PII → moderation`, in that order, on
 * the way in and on the way out.
 *
 * The order is FIXED and enforced here rather than trusted to the caller,
 * because it is load-bearing: the cheap deterministic filter runs first so an
 * org's own banned-word policy never depends on a network call; PII runs next
 * so what reaches an external moderation provider is already scrubbed; the
 * moderation provider — the only step that leaves the process — runs last and
 * therefore sees the least. Passing the filters in a different order does not
 * change the order they run in.
 *
 * Text flows THROUGH the chain: a `modified` outcome rewrites the text that
 * the next filter sees, which is what makes "scrub before you send it out"
 * true rather than aspirational. A `blocked` outcome short-circuits — nothing
 * after it runs, because the message is already refused.
 *
 * The PII step is `lib/pii` — the scrubber is injected as a `Scrubber`, so
 * this module never grows a second implementation of detection or masking. The
 * moderation step is likewise a port: the HTTP provider lives in the
 * governance domain, and this module only decides when it runs and what its
 * verdict means.
 *
 * Layer A: pure, no `node:*`, no Convex.
 */

import {
  blocked,
  flagged,
  modified,
  pass,
  type FilterBlockedOutcome,
  type FilterFlaggedOutcome,
  type FilterName,
  type FilterOutcome,
  type FilterPassOutcome,
  type FilterStepErrorOutcome,
  type GuardrailsDirection,
} from '../pii/core/outcome';
import {
  clampMessage,
  escapeRegExp,
  execWithBudget,
  REGEX_EXEC_BUDGET_MS,
} from '../pii/core/regex-safety';
import type { Scrubber } from '../pii/engine/scrubber';
import type { TokenEntry, Tokenizer } from '../pii/engine/tokenizer';
import type {
  ChatFilterCategory,
  ChatFilterConfig,
} from '../shared/schemas/governance';

/** The canonical chain order. Callers supply filters; the chain runs them in
 * THIS order regardless of how they were supplied. */
export const GUARDRAIL_CHAIN_ORDER: readonly FilterName[] = [
  'chat_filter',
  'pii',
  'moderation_provider',
];

/** One step of the chain. `name` keys it into the canonical order. */
export interface GuardrailFilter {
  readonly name: FilterName;
  run(
    text: string,
    direction: GuardrailsDirection,
  ): FilterOutcome | Promise<FilterOutcome>;
}

/**
 * What a filter's own failure means. Mirrors the moderation policy defaults:
 * a broken filter must not silently swallow a user's message on the way in
 * (`open`), but must not let unreviewed model output through on the way out
 * (`closed`).
 */
export interface GuardrailFailBehavior {
  readonly input: 'open' | 'closed';
  readonly output: 'open' | 'closed';
}

export const DEFAULT_FAIL_BEHAVIOR: GuardrailFailBehavior = {
  input: 'open',
  output: 'closed',
};

export interface GuardrailRefusal {
  readonly filterName: FilterName;
  readonly categoryIds: readonly string[];
  readonly matchCount: number;
  /** Present when the refusal came from a filter FAILING under a fail-closed
   * posture rather than from a detection. */
  readonly stepError?: string;
}

export interface GuardrailChainResult {
  /** The text as the chain leaves it — rewritten by every `modified` step. */
  readonly text: string;
  /** Set when a filter refused; nothing after it ran. */
  readonly refusal?: GuardrailRefusal;
  /** Which filters actually ran, in the order they ran. Recorded so a caller
   * (and a test) can see the order rather than infer it. */
  readonly ran: readonly FilterName[];
  /** Every outcome, for the audit trail and the chat-filter event log. */
  readonly outcomes: ReadonlyArray<{
    readonly filterName: FilterName;
    readonly outcome: FilterOutcome;
  }>;
  /** Category ids from `flagged`/`modified` steps — opaque names, log-safe. */
  readonly flaggedCategoryIds: readonly string[];
}

/** One filter's verdict, as the chain saw it — what the host records as a
 * chat-filter event. Only non-`pass` outcomes are reported: a clean step is
 * the normal case, not an event. */
export interface GuardrailOutcomeEvent {
  readonly filterName: FilterName;
  readonly direction: GuardrailsDirection;
  readonly outcome: Exclude<FilterOutcome, FilterPassOutcome>;
}

export interface GuardrailChainOptions {
  readonly failBehavior?: GuardrailFailBehavior;
  /**
   * Observes every non-pass outcome, in chain order, BEFORE the chain acts
   * on it — so a `blocked` step is reported even though nothing after it
   * runs. The observer's own failure is logged and never changes the
   * verdict: an audit write must not decide whether a message goes through.
   */
  readonly onOutcome?: (event: GuardrailOutcomeEvent) => void | Promise<void>;
}

/**
 * Run the chain over `text`. Filters are addressed by name and executed in
 * {@link GUARDRAIL_CHAIN_ORDER}; a filter that is absent is simply skipped
 * (an org with no moderation provider has no moderation step, not a broken
 * chain).
 */
export async function runGuardrailChain(
  text: string,
  direction: GuardrailsDirection,
  filters: readonly GuardrailFilter[],
  options: GuardrailChainOptions = {},
): Promise<GuardrailChainResult> {
  const failBehavior = options.failBehavior ?? DEFAULT_FAIL_BEHAVIOR;
  const byName = new Map<FilterName, GuardrailFilter>();
  for (const filter of filters) {
    if (byName.has(filter.name)) {
      throw new Error(
        `[chat] two filters claim the name "${filter.name}" — each chain step is exactly one filter`,
      );
    }
    byName.set(filter.name, filter);
  }

  const ran: FilterName[] = [];
  const outcomes: Array<{ filterName: FilterName; outcome: FilterOutcome }> =
    [];
  const flaggedCategoryIds: string[] = [];
  let current = text;

  for (const name of GUARDRAIL_CHAIN_ORDER) {
    const filter = byName.get(name);
    if (!filter) continue;
    ran.push(name);
    const outcome = await filter.run(current, direction);
    outcomes.push({ filterName: name, outcome });
    if (outcome.kind !== 'pass' && options.onOutcome !== undefined) {
      try {
        await options.onOutcome({ filterName: name, direction, outcome });
      } catch (error) {
        console.warn(
          `[chat] guardrail outcome observer failed for "${name}" on ${direction}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }

    switch (outcome.kind) {
      case 'pass':
        break;
      case 'modified':
        current = outcome.text;
        flaggedCategoryIds.push(...outcome.categoryIds);
        break;
      case 'flagged':
        flaggedCategoryIds.push(...outcome.categoryIds);
        break;
      case 'blocked':
        return {
          text: current,
          refusal: {
            filterName: name,
            categoryIds: outcome.categoryIds,
            matchCount: outcome.matchCount,
          },
          ran,
          outcomes,
          flaggedCategoryIds,
        };
      case 'step_error': {
        if (failBehavior[direction] === 'closed') {
          return {
            text: current,
            refusal: {
              filterName: name,
              categoryIds: [],
              matchCount: 0,
              stepError: outcome.reason,
            },
            ran,
            outcomes,
            flaggedCategoryIds,
          };
        }
        console.warn(
          `[chat] guardrail "${name}" failed on ${direction} and the policy is fail-open: ${outcome.reason}`,
        );
        break;
      }
      default: {
        // A new outcome kind must decide what the chain does with it.
        const exhaustive: never = outcome;
        throw new Error(
          `[chat] unhandled guardrail outcome: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }

  return { text: current, ran, outcomes, flaggedCategoryIds };
}

// ------------------------------------------------------------- chat filter

interface CompiledCategory {
  readonly id: string;
  readonly mode: ChatFilterCategory['mode'];
  readonly matchers: readonly RegExp[];
}

/**
 * Compile one category's banned words and custom patterns into runnable
 * regexes. Words become one alternation with unicode-aware boundaries so
 * "class" never matches inside "classic"; patterns are taken as authored —
 * they already passed the schema's `safe-regex2` gate at save time — and are
 * skipped with a warning if they somehow no longer compile, because a stale
 * policy must degrade, not break every message in the org.
 */
function compileCategory(
  category: ChatFilterCategory,
): CompiledCategory | null {
  const matchers: RegExp[] = [];
  const words = category.words.filter((word) => word.trim().length > 0);
  if (words.length > 0) {
    const alternation = [...words]
      .sort((a, b) => b.length - a.length)
      .map((word) => escapeRegExp(word))
      .join('|');
    try {
      matchers.push(
        new RegExp(
          `(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`,
          'giu',
        ),
      );
    } catch (error) {
      console.warn(
        `[chat] chat_filter category "${category.id}" word list failed to compile: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
  for (const pattern of category.patterns) {
    try {
      matchers.push(new RegExp(pattern.regex, 'gi'));
    } catch (error) {
      console.warn(
        `[chat] chat_filter pattern "${pattern.name}" failed to compile: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
  if (matchers.length === 0) return null;
  return { id: category.id, mode: category.mode, matchers };
}

interface CategoryHit {
  readonly category: CompiledCategory;
  readonly spans: ReadonlyArray<{ index: number; length: number }>;
}

/**
 * The org's own banned-word and regex policy — the first chain step, and the
 * only one that needs neither a network call nor a pattern library.
 *
 * Returns `null` when the policy is off, so the caller omits the step rather
 * than running a filter that can only ever pass.
 */
export function createChatFilter(
  config: ChatFilterConfig,
  options: { budgetMs?: number } = {},
): GuardrailFilter | null {
  if (!config.enabled) return null;
  const compiled = config.categories
    .filter((category) => category.enabled)
    .map((category) => compileCategory(category))
    .filter((category): category is CompiledCategory => category !== null);
  if (compiled.length === 0) return null;

  const budgetMs = options.budgetMs ?? REGEX_EXEC_BUDGET_MS;
  const appliesTo = new Set<GuardrailsDirection>(config.appliesTo);

  return {
    name: 'chat_filter',
    run(text, direction) {
      if (!appliesTo.has(direction)) return pass();
      const { text: clamped, truncated } = clampMessage(text);

      const hits: CategoryHit[] = [];
      for (const category of compiled) {
        const spans: Array<{ index: number; length: number }> = [];
        for (const matcher of category.matchers) {
          for (const match of execWithBudget(matcher, clamped, budgetMs)) {
            spans.push({ index: match.index, length: match.length });
          }
        }
        if (spans.length > 0) hits.push({ category, spans });
      }
      if (hits.length === 0) return pass();

      const matchCount = hits.reduce((sum, hit) => sum + hit.spans.length, 0);

      // Block beats mask beats flag: the strictest mode any matching category
      // asks for is the one the message gets.
      const blocking = hits.filter((hit) => hit.category.mode === 'block');
      if (blocking.length > 0) {
        return blocked(
          blocking.map((hit) => hit.category.id),
          blocking.reduce((sum, hit) => sum + hit.spans.length, 0),
          truncated || undefined,
        );
      }

      const masking = hits.filter((hit) => hit.category.mode === 'mask');
      if (masking.length > 0) {
        const spans = masking
          .flatMap((hit) => hit.spans)
          .sort((a, b) => a.index - b.index);
        // The masked text is built from the CLAMPED input: anything past the
        // clamp point was never scanned, so it is dropped rather than
        // re-appended unchecked. `truncated` says so.
        const masked = replaceSpans(clamped, spans, config.maskReplacement);
        return modified(
          masked,
          hits.map((hit) => hit.category.id),
          matchCount,
          truncated || undefined,
        );
      }

      return flagged(
        hits.map((hit) => hit.category.id),
        matchCount,
        truncated || undefined,
      );
    },
  };
}

/** Replace non-overlapping spans left to right; overlaps collapse into the
 * first span so a doubly-matched word is masked once. */
function replaceSpans(
  text: string,
  spans: ReadonlyArray<{ index: number; length: number }>,
  replacement: string,
): string {
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.index < cursor) continue;
    out += text.slice(cursor, span.index) + replacement;
    cursor = span.index + span.length;
  }
  return out + text.slice(cursor);
}

// --------------------------------------------------------------------- pii

/**
 * The PII step, backed by a `lib/pii` scrubber. The scrubber is built from the
 * org's `pii_config` policy by the host (`createScrubberFromConfig`) and
 * injected, so detection, masking, and tokenization have exactly one
 * implementation on the platform.
 *
 * A null scrubber means the policy is off — the caller omits the step.
 */
export function createPiiFilter(
  scrubber: Scrubber | null,
): GuardrailFilter | null {
  if (!scrubber) return null;
  return {
    name: 'pii',
    run(text) {
      return scrubber.scrub(text);
    },
  };
}

/**
 * The PII step in TOKENIZE mode — a round trip rather than a one-way mask.
 * On the way in, detections become indexed tokens (`[EMAIL_1]`) and the
 * restore map is kept for the turn; on the way out, every token the model
 * echoed is replaced by the original value, so the reader sees their own
 * details while the model (and any provider after this step) never did.
 *
 * The restore reports as `modified` with NO categories and NO matches: it
 * rewrites text but detects nothing, so a host recording detections can
 * tell the two apart. One filter instance serves one turn — the map is
 * per-turn state.
 */
export function createPiiTokenizeFilter(
  tokenizer: Tokenizer | null,
): GuardrailFilter | null {
  if (!tokenizer) return null;
  const mapping: Record<string, TokenEntry> = {};
  return {
    name: 'pii',
    run(text, direction) {
      if (direction === 'output') {
        if (Object.keys(mapping).length === 0) return pass();
        const restored = tokenizer.detokenize(text, mapping);
        return restored === text ? pass() : modified(restored, [], 0);
      }
      const result = tokenizer.tokenize(text);
      if (result.segments.length === 0) return pass();
      Object.assign(mapping, result.mapping);
      return modified(
        result.text,
        [...new Set(result.segments.map((segment) => segment.type))],
        result.segments.length,
        result.truncated || undefined,
      );
    },
  };
}

// -------------------------------------------------------------- moderation

/** The external moderation provider, as the chain sees it. The HTTP client,
 * its templates, and its response mapping live in the governance domain. */
export interface ModerationBackend {
  moderate(
    text: string,
    direction: GuardrailsDirection,
  ): Promise<FilterOutcome>;
}

/** How a provider round failed — the class the chat-filter event and the
 * settings page's test result carry; never the provider's words. */
export type ModerationErrorClass =
  | 'timeout'
  | 'network'
  | 'parse'
  | 'http_4xx'
  | 'http_5xx'
  | 'config'
  | 'unknown';

/** The audit facts of one provider round. Never the text, never the body. */
export interface ModerationExtras {
  readonly httpStatus?: number;
  readonly durationMs?: number;
  readonly attempts?: number;
  readonly errorClass?: ModerationErrorClass;
  /** This round's failure tripped the breaker. */
  readonly circuitOpened?: boolean;
  /** The breaker was already open, so no request was made. */
  readonly circuitOpen?: boolean;
}

/** The provider's verdict as the chain consumes it — `step_error` for every
 * provider fault, so the chain's fail behaviour decides. A `mask` mapping
 * reads as `flagged`: an external classifier returns categories, not spans,
 * so there is nothing to mask — the detection is recorded. */
export type ModerationOutcome =
  | FilterPassOutcome
  | FilterFlaggedOutcome
  | FilterBlockedOutcome
  | (FilterStepErrorOutcome & {
      readonly filterName: 'moderation_provider';
      readonly reason: ModerationErrorClass;
    });

/** One provider round: the verdict plus its audit facts. The governance
 * domain produces it; the chat host feeds the verdict to the chain and the
 * facts to the event log. */
export interface ModerationRun {
  readonly outcome: ModerationOutcome;
  readonly extras: ModerationExtras;
}

/**
 * The moderation step. It runs LAST, so the provider only ever sees text the
 * cheaper local filters already accepted and scrubbed.
 */
export function createModerationFilter(
  backend: ModerationBackend | null,
): GuardrailFilter | null {
  if (!backend) return null;
  return {
    name: 'moderation_provider',
    async run(text, direction) {
      try {
        return await backend.moderate(text, direction);
      } catch (error) {
        return {
          kind: 'step_error',
          filterName: 'moderation_provider',
          reason: error instanceof Error ? error.name : 'unknown',
        };
      }
    },
  };
}

// ---------------------------------------------------- output-side transform

export interface OutputTransformChunk {
  /** Text cleared for the client. Empty while the transform is still
   * buffering. */
  readonly text: string;
  /** Set when a filter refused; the caller stops the stream. */
  readonly refusal?: GuardrailRefusal;
}

/**
 * Output guardrails run MID-STREAM: chunks are buffered into segments large
 * enough to be worth checking, each segment goes through the same fixed chain,
 * and only the transformed segment reaches the client. Nothing is emitted
 * unchecked and then retracted, because a retraction is not possible once a
 * token is on the wire.
 */
export interface OutputGuardrailTransform {
  /** Feed one model chunk. */
  push(chunk: string): Promise<OutputTransformChunk>;
  /** End of stream: check and emit whatever is still buffered. */
  flush(): Promise<OutputTransformChunk>;
}

export interface OutputTransformOptions extends GuardrailChainOptions {
  /** Smallest segment worth checking. Small enough to stay responsive, large
   * enough that a pattern is not split across two checks. */
  readonly minFlushChars?: number;
}

export function createOutputTransform(
  filters: readonly GuardrailFilter[],
  options: OutputTransformOptions = {},
): OutputGuardrailTransform {
  const minFlushChars = options.minFlushChars ?? 120;
  const passthrough = filters.length === 0;
  let buffer = '';
  let stopped = false;

  const check = async (segment: string): Promise<OutputTransformChunk> => {
    if (segment.length === 0) return { text: '' };
    const result = await runGuardrailChain(segment, 'output', filters, options);
    if (result.refusal) {
      stopped = true;
      return { text: '', refusal: result.refusal };
    }
    return { text: result.text };
  };

  return {
    async push(chunk) {
      if (stopped) return { text: '' };
      if (passthrough) return check(chunk);
      buffer += chunk;
      if (buffer.length < minFlushChars) return { text: '' };
      const segment = buffer;
      buffer = '';
      return check(segment);
    },
    async flush() {
      if (stopped) return { text: '' };
      const segment = buffer;
      buffer = '';
      return check(segment);
    },
  };
}
