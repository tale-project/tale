import { randomUUID } from 'node:crypto';

import {
  createChatFilter,
  createModerationFilter,
  createPiiFilter,
  createPiiTokenizeFilter,
  DEFAULT_FAIL_BEHAVIOR,
  type GuardrailFilter,
  type GuardrailOutcomeEvent,
  type ModerationBackend,
  type ModerationExtras,
  type ModerationRun,
} from '../../../lib/chat/guardrails';
import type { TurnDeps } from '../../../lib/chat/turn';
import {
  createScrubber,
  createTokenizer,
  PatternRegistry,
  resolveScrubberOptions,
} from '../../../lib/pii';
import { pass } from '../../../lib/pii/core/outcome';
import {
  effectiveMandatoryInstructions,
  POLICY_SCHEMAS,
  type ChatFilterConfig,
  type ModerationProviderConfig,
  type SystemPromptConfig,
} from '../../../lib/shared/schemas/governance';
import type { PiiConfig } from '../../../lib/shared/schemas/pii';
import type { ChatFilterEventInput } from '../governance/chat_filter_events';
import type { ActionCtx } from '../lib/ctx';
import { internal } from '../lib/handler_names';

/**
 * The org's guardrail policies, resolved for ONE chat turn: the three chain
 * steps (`chat_filter` → `pii_config` → `moderation_provider`) built from
 * the governance files, the `system_prompt` mandatory instructions, and
 * the chat-filter event log every non-pass verdict lands in.
 *
 * The pipeline (`lib/chat/turn.ts`) owns the order and the short-circuits;
 * this module only turns policy files into the filters it runs and reports
 * what they decided. Policy reads, the provider round, and the event write
 * all go through the ctx seams, so the same host runs over Postgres today
 * and over whatever answers those names tomorrow.
 */

// ------------------------------------------------------------ the policies

export interface TurnPolicies {
  readonly chatFilter: ChatFilterConfig | null;
  readonly pii: PiiConfig | null;
  readonly moderation: ModerationProviderConfig | null;
  readonly systemPrompt: SystemPromptConfig | null;
}

type TurnPolicyType =
  | 'chat_filter'
  | 'pii_config'
  | 'moderation_provider'
  | 'system_prompt';

/** One policy through the seam, re-validated: an absent or corrupt file
 * reads as "no policy" — a bad governance file must never brick chat. */
async function readPolicy<T extends TurnPolicyType>(
  ctx: ActionCtx,
  organizationId: string,
  policyType: T,
): Promise<ReturnType<(typeof POLICY_SCHEMAS)[T]['parse']> | null> {
  const raw: unknown = await ctx.runQuery(
    internal.governance.internal_queries.getPolicyConfigInternal,
    { organizationId, policyType },
  );
  if (raw === null || raw === undefined) return null;
  const parsed = POLICY_SCHEMAS[policyType].safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[chat] ignoring unparseable ${policyType} policy for organization ${organizationId}: ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
    return null;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by POLICY_SCHEMAS[policyType] above
  return parsed.data as ReturnType<(typeof POLICY_SCHEMAS)[T]['parse']>;
}

/** The four policy files a turn reads, in one parallel slot. */
export async function readTurnPolicies(
  ctx: ActionCtx,
  organizationId: string,
): Promise<TurnPolicies> {
  const [chatFilter, pii, moderation, systemPrompt] = await Promise.all([
    readPolicy(ctx, organizationId, 'chat_filter'),
    readPolicy(ctx, organizationId, 'pii_config'),
    readPolicy(ctx, organizationId, 'moderation_provider'),
    readPolicy(ctx, organizationId, 'system_prompt'),
  ]);
  return { chatFilter, pii, moderation, systemPrompt };
}

/** The org's mandatory instructions for the turn's system prompt — absent
 * when the policy is missing, disabled, or blank. */
export function mandatoryInstructionsFor(
  policies: TurnPolicies,
): string | undefined {
  return policies.systemPrompt === null
    ? undefined
    : effectiveMandatoryInstructions(policies.systemPrompt);
}

// -------------------------------------------------------------- the filters

/**
 * The PII step from the org's policy: a one-way scrubber for `mask` and
 * `block`, the tokenize round trip for `tokenize`. Construction faults
 * degrade to "no PII step" with a warning, as the indexing gate does — a
 * governance typo must not take an organization's chat offline.
 */
function buildPiiFilter(config: PiiConfig | null): GuardrailFilter | null {
  if (config === null || !config.enabled) return null;
  try {
    const options = resolveScrubberOptions(
      config,
      PatternRegistry.fromDefaults(),
    );
    if (options === null) return null;
    return config.mode === 'tokenize'
      ? createPiiTokenizeFilter(createTokenizer(options))
      : createPiiFilter(createScrubber(options));
  } catch (error) {
    console.warn(
      `[chat] PII guardrail could not be built, running without it: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return null;
  }
}

export interface TurnGuardrailArgs {
  readonly organizationId: string;
  readonly threadId: string;
  readonly agentSlug?: string;
  readonly policies: TurnPolicies;
}

/** The audit facts a moderation round leaves for its event row. */
function moderationFacts(
  extras: ModerationExtras | undefined,
): Pick<ChatFilterEventInput, 'httpStatus' | 'durationMs' | 'attempt'> {
  if (extras === undefined) return {};
  return {
    ...(extras.httpStatus !== undefined
      ? { httpStatus: extras.httpStatus }
      : {}),
    ...(extras.durationMs !== undefined
      ? { durationMs: extras.durationMs }
      : {}),
    ...(extras.attempts !== undefined ? { attempt: extras.attempts } : {}),
  };
}

/**
 * One chain verdict as an event row — or null for a rewrite that detected
 * nothing (the tokenize restore on the way out), which is not an event.
 */
export function chatFilterEventFor(
  event: GuardrailOutcomeEvent,
  moderationExtras: ModerationExtras | undefined,
): Omit<
  ChatFilterEventInput,
  'sanitizationRunId' | 'threadId' | 'agentSlug' | 'actorType'
> | null {
  const { filterName, direction, outcome } = event;
  const extras =
    filterName === 'moderation_provider' ? moderationExtras : undefined;
  switch (outcome.kind) {
    case 'modified':
    case 'flagged':
      if (outcome.matchCount === 0) return null;
      return {
        filterName,
        direction,
        kind: 'detected',
        categoryIds: outcome.categoryIds,
        matchCount: outcome.matchCount,
        ...(outcome.truncated !== undefined
          ? { truncated: outcome.truncated }
          : {}),
        ...moderationFacts(extras),
      };
    case 'blocked':
      return {
        filterName,
        direction,
        kind: 'blocked',
        categoryIds: outcome.categoryIds,
        matchCount: outcome.matchCount,
        ...(outcome.truncated !== undefined
          ? { truncated: outcome.truncated }
          : {}),
        ...moderationFacts(extras),
      };
    case 'step_error':
      return {
        filterName,
        direction,
        kind: extras?.circuitOpen === true ? 'circuit_open' : 'step_error',
        categoryIds: [],
        errorClass: outcome.reason,
        ...moderationFacts(extras),
      };
    default: {
      const exhaustive: never = outcome;
      throw new Error(
        `[chat] unhandled guardrail outcome: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/**
 * Build the turn's guardrail deps. One filter list serves both directions
 * — each step decides for itself whether it applies on the way in or out
 * (`appliesTo` on the chat filter and the provider; the PII round trip by
 * construction). Every non-pass verdict is written as a chat-filter event
 * through the ctx seam; a failed write is logged and never changes the
 * verdict.
 */
export function buildTurnGuardrails(
  ctx: ActionCtx,
  args: TurnGuardrailArgs,
): Pick<TurnDeps, 'inputFilters' | 'outputFilters' | 'guardrailOptions'> {
  const { organizationId, threadId, policies } = args;
  const filters: GuardrailFilter[] = [];

  const chatFilter =
    policies.chatFilter === null ? null : createChatFilter(policies.chatFilter);
  if (chatFilter !== null) filters.push(chatFilter);

  const pii = buildPiiFilter(policies.pii);
  if (pii !== null) filters.push(pii);

  /** The facts of the LAST provider round, read by the event observer that
   * fires right after the moderation step — the chain runs its steps one at
   * a time, so the pair can never interleave. */
  let lastModeration: ModerationExtras | undefined;
  const moderation = policies.moderation;
  if (moderation !== null && moderation.enabled) {
    const appliesTo = new Set(moderation.appliesTo);
    const backend: ModerationBackend = {
      async moderate(text, direction) {
        if (!appliesTo.has(direction)) return pass();
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the governance seam answers exactly this shape
        const run = (await ctx.runAction(
          internal.governance.internal_actions.runModerationProvider,
          { organizationId, direction, text, config: moderation },
        )) as ModerationRun;
        lastModeration = run.extras;
        return run.outcome;
      },
    };
    const filter = createModerationFilter(backend);
    if (filter !== null) filters.push(filter);
  }

  const sanitizationRunId = randomUUID();
  const onOutcome = async (event: GuardrailOutcomeEvent): Promise<void> => {
    const row = chatFilterEventFor(
      event,
      event.filterName === 'moderation_provider' ? lastModeration : undefined,
    );
    if (row === null) return;
    try {
      await ctx.runMutation(
        internal.governance.internal_mutations.recordChatFilterEvent,
        {
          organizationId,
          sanitizationRunId,
          threadId,
          ...(args.agentSlug !== undefined
            ? { agentSlug: args.agentSlug }
            : {}),
          actorType: 'user',
          ...row,
        } satisfies ChatFilterEventInput & { organizationId: string },
      );
    } catch (error) {
      console.warn(
        `[chat] chat-filter event write failed for thread ${threadId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  };

  return {
    inputFilters: filters,
    outputFilters: filters,
    guardrailOptions: {
      failBehavior: moderation?.failBehavior ?? DEFAULT_FAIL_BEHAVIOR,
      onOutcome,
    },
  };
}
