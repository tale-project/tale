import { ConvexError } from 'convex/values';

import {
  chatFilterConfigSchema,
  moderationProviderConfigSchema,
  piiConfigSchema,
  type ChatFilterConfig,
  type ModerationProviderConfig,
} from '../../lib/shared/schemas/governance';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { runChatFilter } from './chat_filter';
import type { FilterOutcome, GuardrailsDirection } from './filter_outcome';
import { scrubPii, type PiiConfig } from './pii';

/**
 * Snapshot of all guardrails configs for one sanitize invocation. Callers
 * must fetch this via `getGuardrailsConfigsInternal` once per message (or
 * once at stream start for output filtering) and pass the frozen object
 * to every `sanitizeMessage` / `finalizeSanitize` call. Filters never
 * re-fetch config mid-message.
 */
export interface GuardrailsSnapshot {
  chatFilter: NormalizedConfig<ChatFilterConfig> | null;
  pii: NormalizedConfig<PiiConfig> | null;
  moderation: NormalizedConfig<ModerationProviderConfig> | null;
}

export interface NormalizedConfig<T> {
  policyDocId: string;
  updatedAt: number;
  enabled: boolean;
  config: T;
}

export interface SanitizeMeta {
  organizationId: string;
  orgSlug: string;
  threadId: string;
  messageId?: string;
  agentSlug?: string;
  actorId?: string;
  actorEmail?: string;
  actorType?: 'user' | 'api' | 'assistant' | 'system';
}

interface AuditAccumulator {
  categoryIds: string[];
  matchCount: number;
  truncated: boolean;
}

function accumulate(
  acc: AuditAccumulator,
  outcome: Extract<FilterOutcome, { kind: 'modified' | 'flagged' | 'blocked' }>,
): void {
  for (const id of outcome.categoryIds) {
    if (!acc.categoryIds.includes(id)) acc.categoryIds.push(id);
  }
  acc.matchCount += outcome.matchCount;
  if (outcome.truncated) acc.truncated = true;
}

async function flushAudit(
  ctx: ActionCtx,
  filterName: 'pii' | 'chat_filter' | 'moderation_provider',
  kind: 'detected' | 'blocked' | 'step_error' | 'circuit_open',
  direction: GuardrailsDirection,
  runId: string,
  meta: SanitizeMeta,
  acc: AuditAccumulator,
  extras: {
    errorClass?:
      | 'timeout'
      | 'network'
      | 'parse'
      | 'http_4xx'
      | 'http_5xx'
      | 'config'
      | 'unknown';
    httpStatus?: number;
    durationMs?: number;
    attempt?: number;
  } = {},
): Promise<void> {
  await ctx.runMutation(
    internal.chat_filter_events.internal_mutations.recordEvent,
    {
      organizationId: meta.organizationId,
      sanitizationRunId: runId,
      threadId: meta.threadId,
      messageId: meta.messageId,
      filterName,
      direction,
      kind,
      categoryIds: acc.categoryIds,
      matchCount: acc.matchCount > 0 ? acc.matchCount : undefined,
      truncated: acc.truncated ? true : undefined,
      errorClass: extras.errorClass,
      httpStatus: extras.httpStatus,
      durationMs: extras.durationMs,
      attempt: extras.attempt,
      agentSlug: meta.agentSlug,
      actorType: meta.actorType,
    },
  );

  if (kind === 'blocked') {
    // Secondary: write to the signed hash-chain audit log for compliance.
    const auditActorType: 'user' | 'system' | 'api' | 'workflow' =
      meta.actorType === 'assistant' ? 'system' : (meta.actorType ?? 'user');
    await ctx.runMutation(
      internal.audit_logs.internal_mutations.createAuditLog,
      {
        organizationId: meta.organizationId,
        actorId: meta.actorId ?? 'system',
        actorEmail: meta.actorEmail,
        actorType: auditActorType,
        action: `${filterName}.blocked_in_chat`,
        category: 'security',
        resourceType: 'chat_message',
        resourceId: meta.threadId,
        status: 'denied',
        errorMessage: `Blocked by ${filterName}: ${acc.categoryIds.join(', ')}`,
        metadata: {
          sanitizationRunId: runId,
          direction,
          categoryIds: acc.categoryIds,
          matchCount: acc.matchCount,
          agentSlug: meta.agentSlug,
        },
      },
    );
  }
}

function blockError(
  code: 'pii.blocked' | 'chat_filter.blocked' | 'moderation_provider.blocked',
  runId: string,
  direction: GuardrailsDirection,
  categoryIds: string[],
  categoryLabels: string[],
): ConvexError<{
  message: string;
  code: typeof code;
  sanitizationRunId: string;
  direction: GuardrailsDirection;
  categoryIds: string[];
  categoryLabels: string[];
}> {
  const legacyPrefix =
    code === 'pii.blocked'
      ? 'Message blocked: PII detected'
      : code === 'chat_filter.blocked'
        ? 'Message blocked: chat filter'
        : 'Message blocked: content policy';
  // Surface admin-edited labels in the user-visible message (e.g. "脏话"
  // instead of "custom_mgskmh") while keeping the raw slugs in `.data` for
  // dashboards / correlation.
  const message = `${legacyPrefix} (${categoryLabels.join(', ')}).`;
  return new ConvexError({
    message,
    code,
    sanitizationRunId: runId,
    direction,
    categoryIds,
    categoryLabels,
  });
}

// Resolve immutable chat_filter slugs to current admin-edited labels. PII
// pattern names and moderation provider internalLabels are already
// human-readable so we return them as-is.
function resolveLabels(
  filter: 'pii' | 'chat_filter' | 'moderation_provider',
  categoryIds: string[],
  snapshot: GuardrailsSnapshot,
): string[] {
  if (filter !== 'chat_filter') return categoryIds;
  const chat = snapshot.chatFilter;
  if (!chat) return categoryIds;
  const labelById = new Map(chat.config.categories.map((c) => [c.id, c.label]));
  return categoryIds.map((id) => labelById.get(id) ?? id);
}

/**
 * Normalize a raw `governancePolicies` row into a typed snapshot entry.
 * Legacy rows without new fields fall through Zod `.default()` silently.
 */
function normalizeChatFilter(
  row: unknown,
): NormalizedConfig<ChatFilterConfig> | null {
  if (!isRecord(row)) return null;
  const parsed = chatFilterConfigSchema.safeParse(row['config']);
  if (!parsed.success) {
    console.warn(
      `[guardrails] invalid chat_filter config in DB: ${parsed.error.message}`,
    );
    return null;
  }
  return {
    policyDocId: typeof row['_id'] === 'string' ? row['_id'] : '',
    updatedAt: typeof row['updatedAt'] === 'number' ? row['updatedAt'] : 0,
    enabled: row['enabled'] !== false && parsed.data.enabled,
    config: parsed.data,
  };
}

function normalizePii(row: unknown): NormalizedConfig<PiiConfig> | null {
  if (!isRecord(row)) return null;
  // Legacy rows written by the bespoke `upsertPiiConfig` mutation stored
  // `enabled` as the top-level column only and never inside `config`. The
  // current schema requires `enabled` inside `config`, so without this
  // injection `safeParse` rejects legacy rows and PII silently stops
  // filtering. Top-level column is authoritative either way.
  const rawConfig = isRecord(row['config']) ? row['config'] : {};
  const configWithEnabled = {
    ...rawConfig,
    enabled:
      typeof rawConfig['enabled'] === 'boolean'
        ? rawConfig['enabled']
        : row['enabled'] !== false,
  };
  const parsed = piiConfigSchema.safeParse(configWithEnabled);
  if (!parsed.success) {
    console.warn(
      `[guardrails] invalid pii_config in DB: ${parsed.error.message}`,
    );
    return null;
  }
  return {
    policyDocId: typeof row['_id'] === 'string' ? row['_id'] : '',
    updatedAt: typeof row['updatedAt'] === 'number' ? row['updatedAt'] : 0,
    enabled: row['enabled'] !== false && parsed.data.enabled,
    config: parsed.data,
  };
}

function normalizeModeration(
  row: unknown,
): NormalizedConfig<ModerationProviderConfig> | null {
  if (!isRecord(row)) return null;
  const parsed = moderationProviderConfigSchema.safeParse(row['config']);
  if (!parsed.success) {
    console.warn(
      `[guardrails] invalid moderation_provider config in DB: ${parsed.error.message}`,
    );
    return null;
  }
  return {
    policyDocId: typeof row['_id'] === 'string' ? row['_id'] : '',
    updatedAt: typeof row['updatedAt'] === 'number' ? row['updatedAt'] : 0,
    enabled: row['enabled'] !== false && parsed.data.enabled,
    config: parsed.data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadGuardrailsSnapshot(
  ctx: ActionCtx,
  organizationId: string,
): Promise<GuardrailsSnapshot> {
  const raw = await ctx.runQuery(
    internal.governance.internal_queries.getGuardrailsConfigsInternal,
    { organizationId },
  );
  return {
    chatFilter: normalizeChatFilter(raw.chatFilter),
    pii: normalizePii(raw.pii),
    moderation: normalizeModeration(raw.moderation),
  };
}

export interface SanitizeResult {
  text: string;
  sanitizationRunId: string;
}

/**
 * Run the guardrails pipeline over a full message. Filters execute in the
 * order chat_filter → PII → moderation_provider; any `blocked` outcome
 * short-circuits and throws a ConvexError with the legacy substring in
 * `.message` (old clients `.includes`) and structured fields in `.data`.
 *
 * `mask`/`flag`/`step_error` are aggregated to a single `chatFilterEvents`
 * row per filter per direction. Raw matched text is NEVER persisted.
 */
export async function sanitizeMessage(
  ctx: ActionCtx,
  rawText: string,
  direction: GuardrailsDirection,
  snapshot: GuardrailsSnapshot,
  meta: SanitizeMeta,
): Promise<SanitizeResult> {
  const runId = globalThis.crypto.randomUUID();

  if (process.env.GUARDRAILS_DISABLED === '1') {
    return { text: rawText, sanitizationRunId: runId };
  }

  let current = rawText;

  // ---------------- chat_filter ----------------
  if (
    snapshot.chatFilter?.enabled &&
    snapshot.chatFilter.config.appliesTo.includes(direction)
  ) {
    const acc: AuditAccumulator = {
      categoryIds: [],
      matchCount: 0,
      truncated: false,
    };
    const outcome = runChatFilter({
      text: current,
      config: snapshot.chatFilter.config,
      policyDocId: snapshot.chatFilter.policyDocId,
      updatedAt: snapshot.chatFilter.updatedAt,
    });
    if (outcome.kind === 'blocked') {
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'blocked',
        direction,
        runId,
        meta,
        acc,
      );
      throw blockError(
        'chat_filter.blocked',
        runId,
        direction,
        outcome.categoryIds,
        resolveLabels('chat_filter', outcome.categoryIds, snapshot),
      );
    }
    if (outcome.kind === 'modified') {
      current = outcome.text;
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'detected',
        direction,
        runId,
        meta,
        acc,
      );
    } else if (outcome.kind === 'flagged') {
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'detected',
        direction,
        runId,
        meta,
        acc,
      );
    }
  }

  // ---------------- PII (input-only) ----------------
  // PII scrubbing guards user-submitted text from leaking to external LLM
  // providers. It does NOT run on output — assistant responses go through
  // chat_filter + moderation_provider instead. Output-side PII would need
  // its own per-direction config (different mode, different patterns) and
  // is deferred until there's a concrete use case.
  if (direction === 'input' && snapshot.pii?.enabled) {
    const acc: AuditAccumulator = {
      categoryIds: [],
      matchCount: 0,
      truncated: false,
    };
    const outcome = scrubPii(current, snapshot.pii.config);
    if (outcome.kind === 'blocked') {
      accumulate(acc, outcome);
      await flushAudit(ctx, 'pii', 'blocked', direction, runId, meta, acc);
      throw blockError(
        'pii.blocked',
        runId,
        direction,
        outcome.categoryIds,
        outcome.categoryIds,
      );
    }
    if (outcome.kind === 'modified') {
      current = outcome.text;
      accumulate(acc, outcome);
      await flushAudit(ctx, 'pii', 'detected', direction, runId, meta, acc);
    }
  }

  // ---------------- moderation_provider ----------------
  if (
    snapshot.moderation?.enabled &&
    snapshot.moderation.config.appliesTo.includes(direction)
  ) {
    const acc: AuditAccumulator = {
      categoryIds: [],
      matchCount: 0,
      truncated: false,
    };
    const { outcome, extras } = await ctx.runAction(
      internal.governance.moderation_provider.internal_actions
        .runModerationProviderAction,
      {
        organizationId: meta.organizationId,
        orgSlug: meta.orgSlug,
        direction,
        text: current,
        endpoint: snapshot.moderation.config.endpoint,
        responseShape: snapshot.moderation.config.responseShape,
        categoryMappings: snapshot.moderation.config.categoryMappings,
        failBehavior: snapshot.moderation.config.failBehavior,
      },
    );
    if (outcome.kind === 'step_error') {
      if (extras.circuitOpened) {
        await flushAudit(
          ctx,
          'moderation_provider',
          'circuit_open',
          direction,
          runId,
          meta,
          acc,
          extras,
        );
      } else {
        await flushAudit(
          ctx,
          'moderation_provider',
          'step_error',
          direction,
          runId,
          meta,
          acc,
          extras,
        );
      }
      // failOpen: proceed (fail-through to pass). failClosed would have
      // returned `blocked` from runModerationProvider.
    } else if (outcome.kind === 'blocked') {
      const categoryIds = outcome.categoryIds ?? [];
      accumulate(acc, {
        kind: 'blocked',
        categoryIds,
        matchCount: outcome.matchCount ?? 0,
      });
      await flushAudit(
        ctx,
        'moderation_provider',
        'blocked',
        direction,
        runId,
        meta,
        acc,
        extras,
      );
      throw blockError(
        'moderation_provider.blocked',
        runId,
        direction,
        categoryIds,
        categoryIds,
      );
    } else if (outcome.kind === 'flagged') {
      const categoryIds = outcome.categoryIds ?? [];
      const matchCount = outcome.matchCount ?? 0;
      accumulate(acc, { kind: 'flagged', categoryIds, matchCount });
      await flushAudit(
        ctx,
        'moderation_provider',
        'detected',
        direction,
        runId,
        meta,
        acc,
        extras,
      );
    }
  }

  return { text: current, sanitizationRunId: runId };
}

/**
 * Finalize sweep for streaming output. Runs only chat_filter over the
 * full accumulated text — NOT moderation_provider (already invoked
 * chunk-by-chunk, avoiding double provider cost + duplicate audit
 * entries), and NOT PII (input-only, see `sanitizeMessage`).
 *
 * Cross-chunk matches (word split across two deltas) are caught here.
 */
export async function finalizeSanitize(
  ctx: ActionCtx,
  rawText: string,
  snapshot: GuardrailsSnapshot,
  meta: SanitizeMeta,
): Promise<SanitizeResult> {
  const runId = globalThis.crypto.randomUUID();

  if (process.env.GUARDRAILS_DISABLED === '1') {
    return { text: rawText, sanitizationRunId: runId };
  }

  let current = rawText;
  const direction: GuardrailsDirection = 'output';

  if (
    snapshot.chatFilter?.enabled &&
    snapshot.chatFilter.config.appliesTo.includes(direction)
  ) {
    const acc: AuditAccumulator = {
      categoryIds: [],
      matchCount: 0,
      truncated: false,
    };
    const outcome = runChatFilter({
      text: current,
      config: snapshot.chatFilter.config,
      policyDocId: snapshot.chatFilter.policyDocId,
      updatedAt: snapshot.chatFilter.updatedAt,
    });
    if (outcome.kind === 'blocked') {
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'blocked',
        direction,
        runId,
        meta,
        acc,
      );
      throw blockError(
        'chat_filter.blocked',
        runId,
        direction,
        outcome.categoryIds,
        resolveLabels('chat_filter', outcome.categoryIds, snapshot),
      );
    }
    if (outcome.kind === 'modified') {
      current = outcome.text;
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'detected',
        direction,
        runId,
        meta,
        acc,
      );
    } else if (outcome.kind === 'flagged') {
      accumulate(acc, outcome);
      await flushAudit(
        ctx,
        'chat_filter',
        'detected',
        direction,
        runId,
        meta,
        acc,
      );
    }
  }

  return { text: current, sanitizationRunId: runId };
}
