import type { Sql, TransactionSql } from 'postgres';

import {
  checkProviderHostPolicy,
  privateProviderHostsAllowed,
} from '../../../lib/net/host-policy.ts';
import {
  SafeFetchError,
  safeFetchBinary,
} from '../../../lib/net/safe-fetch.ts';
import {
  MAX_TTS_CHARS_PER_MESSAGE,
  MAX_TTS_CHUNK_CHARS,
  MAX_TTS_CHUNKS_PER_MESSAGE,
  MIN_TTS_AUDIO_BYTES,
  TTS_FETCH_TIMEOUT_MS,
  TTS_WATCHDOG_BUFFER_MS,
} from '../../../lib/shared/constants/tts.ts';
import { TTS_SLUG } from '../../../lib/shared/constants/usage.ts';
import { estimateTtsCostCents } from '../../core/governance/cost_estimation.ts';
import { resolveTtsModel } from '../../core/lib/providers/resolve_tts_model.ts';
import { sanitizeError } from '../../core/lib/utils/sanitize_secrets.ts';
import { AUDIO_MIME_BY_FORMAT } from '../../core/tts/audio_mime.ts';
import {
  errorCodeFromCaught,
  parseRetryAfterMs,
  TtsProviderHttpError,
  ttsErrorCodeLiterals,
  type TtsErrorCode,
} from '../../core/tts/error_codes.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import type { TaskPayloads } from '../../jobs/tasks.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  checkOrganizationRateLimit,
  checkUserRateLimit,
  limitRate,
  RateLimitExceededError,
} from '../../lib/rate-limit.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { chatShimHandlers } from '../chat/shim.ts';
import { loadOwnedThread, readThreadProjectId } from '../chat/threads.ts';
import { deleteOrgBlobRefs, putOrgBlobBytes } from '../files/service.ts';
import {
  findBudgetViolation,
  loadBudgetSubject,
} from '../governance/budget-gate.ts';
import {
  lockBudgetAdmission,
  readInFlightReservations,
} from '../governance/budget-reservations.ts';
import { incrementUsageLedger } from '../governance/service.ts';

/**
 * Text-to-speech — the 0.5 twin of `convex/tts`: per-chunk client-driven
 * synthesis with the reserve → provider call → settle choreography and the
 * SAME cost discipline (per-chunk char cap, per-message char/chunk caps,
 * per-user + per-org rate limits, prospective budget gating with the real
 * per-model rate, post-success ledger rows under the `TTS_SLUG` sentinel).
 *
 * PURE 0.4 pieces reused: the model resolver (over the chat shim's provider
 * seams), the closed error-code vocabulary, the host-policy re-check, the
 * capped binary fetch, cost estimation, and the budget rule evaluators.
 * Rule-5 upgrades: the `(message_id, chunk_index)` UNIQUE index replaces the
 * 0.4 post-insert dedupe walk (racers serialize on a per-(message, index)
 * advisory lock taken before the row read — FOR UPDATE over zero rows locks
 * nothing, so the first reserve of a chunk needs the lock, not the
 * constraint), and the stuck-pending watchdog is a pg-boss job instead of a
 * best-effort scheduler call.
 */

const CHUNK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_PASS_LIMIT = 64;
const PENDING_STALE_MS = TTS_FETCH_TIMEOUT_MS + 30_000;
const PROSPECTIVE_TTS_CENTS_PER_M_CHARS = 1500;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const ERROR_CODES = new Set<string>(ttsErrorCodeLiterals);

export class TtsError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 429;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 429 = 400,
    retryAfterMs?: number,
    /** The refusal this one wraps (a rate limit), for the door to answer. */
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface ChunkRow {
  id: string;
  organizationId: string;
  threadId: string;
  messageId: string;
  userId: string;
  teamId: string | null;
  agentSlug: string | null;
  index: number;
  text: string;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  voice: string | null;
  providerName: string | null;
  modelId: string | null;
  format: string | null;
  storageRef: string | null;
  characterCount: number | null;
  costEstimateCents: number | null;
  reservedCostCents: number | null;
  projectIds: string[] | null;
  usageRecordedAt: number | null;
  createdAt: number;
  attemptCreatedAt: number;
}

const CHUNK_COLUMNS = `
  id, org_id AS "organizationId", thread_id AS "threadId",
  message_id AS "messageId", user_id AS "userId", team_id AS "teamId",
  agent_slug AS "agentSlug", chunk_index AS "index", text, status, error,
  voice, provider_name AS "providerName", model_id AS "modelId", format,
  storage_ref AS "storageRef", character_count::float8 AS "characterCount",
  cost_estimate_cents AS "costEstimateCents",
  reserved_cost_cents AS "reservedCostCents", project_ids AS "projectIds",
  usage_recorded_at_ms::float8 AS "usageRecordedAt",
  created_at_ms::float8 AS "createdAt",
  attempt_created_at_ms::float8 AS "attemptCreatedAt"
`;

// ------------------------------------------------------------- voice mode

/** Org-level kill switch: `voice_output` policy file, `enabled: false`
 * vetoes; missing file reads as ON. */
async function isVoiceOutputOrgEnabled(
  sql: Sql,
  organizationId: string,
): Promise<boolean> {
  const policy = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'voice_output',
  );
  if (!policy) return true;
  return policy.enabled;
}

export async function getVoiceModeEffective(
  sql: Sql,
  args: { organizationId: string; userId: string; threadId?: string },
): Promise<{
  enabled: boolean;
  userDefault: boolean;
  source: 'thread' | 'preferences' | 'default' | 'org_policy';
}> {
  const orgEnabled = await isVoiceOutputOrgEnabled(sql, args.organizationId);
  if (!orgEnabled) {
    return { enabled: false, userDefault: false, source: 'org_policy' };
  }
  const prefs = await sql<{ voiceOutput: boolean | null }[]>`
    SELECT voice_output AS "voiceOutput" FROM app.user_preferences
    WHERE user_id = ${args.userId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const userDefault = prefs[0]?.voiceOutput === true;
  if (args.threadId !== undefined) {
    const thread = await loadOwnedThread(
      sql,
      args.organizationId,
      args.userId,
      args.threadId,
    );
    if (thread) {
      const overrides = await sql<{ override: boolean | null }[]>`
        SELECT voice_output_override AS override FROM app.thread_metadata
        WHERE thread_id = ${args.threadId} LIMIT 1
      `;
      const override = overrides[0]?.override;
      if (typeof override === 'boolean') {
        return { enabled: override, userDefault, source: 'thread' };
      }
    }
  }
  if (prefs[0]?.voiceOutput !== null && prefs[0]?.voiceOutput !== undefined) {
    return { enabled: userDefault, userDefault, source: 'preferences' };
  }
  return { enabled: false, userDefault: false, source: 'default' };
}

/** The user's global voice-output default (row created on demand). */
export async function setUserVoiceOutput(
  sql: Sql,
  args: { organizationId: string; userId: string; enabled: boolean },
): Promise<void> {
  await sql`
    INSERT INTO app.user_preferences (
      user_id, org_id, custom_instructions, voice_output, updated_at
    ) VALUES (
      ${args.userId}, ${args.organizationId}, '', ${args.enabled},
      ${Date.now()}
    )
    ON CONFLICT (user_id, org_id) DO UPDATE SET
      voice_output = ${args.enabled}, updated_at = ${Date.now()}
  `;
}

/** Per-thread override; `null` clears it (inherit the user default). */
export async function setThreadVoiceOutputOverride(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    threadId: string;
    override: boolean | null;
  },
): Promise<void> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (!thread) {
    throw new TtsError('FORBIDDEN', 'This conversation does not exist.', 403);
  }
  await sql`
    UPDATE app.thread_metadata SET
      voice_output_override = ${args.override}
    WHERE thread_id = ${args.threadId}
  `;
}

// ---------------------------------------------------------------- reserve

type ReserveOutcome =
  | { kind: 'ready' }
  | { kind: 'pending-in-flight' }
  | {
      kind: 'reserved';
      chunkId: string;
      attemptCreatedAt: number;
    };

/**
 * Reserve the `(message, index)` chunk row for one synthesis attempt.
 * Exported for the real-Postgres race proof (integration-check) — the app
 * door is `synthesizeChunk`.
 */
export async function reserveChunk(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    messageId: string;
    threadId: string;
    index: number;
    text: string;
    locale: string;
    agentSlug: string | null;
    prospectiveCostCentsPerMChars: number | undefined;
    providerName?: string;
    modelId?: string;
  },
): Promise<ReserveOutcome> {
  if (
    !Number.isInteger(args.index) ||
    args.index < 0 ||
    args.index >= MAX_TTS_CHUNKS_PER_MESSAGE
  ) {
    throw new TtsError(
      'TTS_CHUNK_LIMIT',
      `TTS chunk index must be in [0, ${MAX_TTS_CHUNKS_PER_MESSAGE}).`,
    );
  }

  return sql.begin(async (tx) => {
    // Every spending lane takes this before its own row locks, then writes
    // its hold before releasing it. Distinct voice chunks share the cap.
    await lockBudgetAdmission(tx, args.organizationId);
    // Serialize reserves per (message, index) BEFORE the row read. The unique
    // row is the race arbiter once it exists, but `FOR UPDATE` over zero rows
    // locks nothing: two first-time reserves of one chunk both saw no row and
    // both reached the INSERT, and the loser surfaced the unique violation
    // as a raw 500 instead of the `in-flight` answer the player polls on.
    // The second racer now waits here, then reads the winner's committed
    // pending row and takes the existing-row branch.
    await tx`
      SELECT pg_advisory_xact_lock(
        hashtextextended('tts:' || ${args.messageId} || ':' || ${String(args.index)}, 0)
      )
    `;
    const existingRows = await tx<ChunkRow[]>`
      SELECT ${tx.unsafe(CHUNK_COLUMNS)} FROM app.tts_audio_chunks
      WHERE message_id = ${args.messageId} AND chunk_index = ${args.index}
      LIMIT 1
      FOR UPDATE
    `;
    const existing = existingRows[0];
    if (existing) {
      if (
        existing.threadId !== args.threadId ||
        existing.organizationId !== args.organizationId
      ) {
        // Identity mismatch is a security signal: the caller knows a
        // messageId that exists in a different thread / org.
        await createAuditLog(tx, {
          organizationId: args.organizationId,
          actorId: args.userId,
          actorType: 'user',
          action: 'tts.synthesize_denied',
          category: 'security',
          resourceType: 'tts_audio_chunk',
          resourceId: existing.id,
          metadata: {
            reason: 'identity_mismatch',
            requestedMessageId: args.messageId,
            requestedThreadId: args.threadId,
            ownedThreadId: existing.threadId,
          },
          status: 'denied',
        });
        throw new TtsError('forbidden', 'TTS chunk identity mismatch.', 403);
      }
      if (existing.status === 'ready' && existing.storageRef !== null) {
        return { kind: 'ready' };
      }
      if (existing.status === 'pending') {
        const age = Date.now() - existing.createdAt;
        if (age < PENDING_STALE_MS) {
          return { kind: 'pending-in-flight' };
        }
        // Stale pending — the attempt crashed; fall through to overwrite.
      }
      // A timeout is not evidence that the provider did no work. Preserve
      // the old estimate before evaluating or replacing its reservation.
      // A refused replacement rolls back this booking and retains its hold.
      await recordUnknownAttemptEstimate(tx, existing);
    }

    // Per-message character cap across every counted chunk (terminally
    // failed rows that never billed don't count — a repaired retry must
    // not falsely trip the cap).
    const counted = await tx<
      {
        id: string;
        textLen: number;
        status: string;
        usageRecordedAt: number | null;
      }[]
    >`
      SELECT id, length(text)::float8 AS "textLen", status,
             usage_recorded_at_ms::float8 AS "usageRecordedAt"
      FROM app.tts_audio_chunks
      WHERE message_id = ${args.messageId}
        AND thread_id = ${args.threadId}
        AND org_id = ${args.organizationId}
    `;
    let existingChars = 0;
    for (const row of counted) {
      if (existing && row.id === existing.id) continue;
      if (row.status === 'failed' && row.usageRecordedAt === null) continue;
      existingChars += row.textLen;
    }
    if (existingChars + args.text.length > MAX_TTS_CHARS_PER_MESSAGE) {
      throw new TtsError(
        'MESSAGE_CHAR_LIMIT',
        `TTS character limit reached for this message (cap ${MAX_TTS_CHARS_PER_MESSAGE}).`,
      );
    }

    // Bounded-cost guards: per-user pinpoints the abuser; per-org backs up.
    try {
      await checkUserRateLimit(tx, 'tts:synthesize:user', args.userId, 1);
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        // Coded for the shim and job consumers; the app door answers the one
        // 429 from the cause (`rateLimitExceededCause`).
        throw new TtsError(
          'RATE_LIMITED',
          'TTS rate limit exceeded for this user.',
          429,
          error.retryAfter,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      await checkOrganizationRateLimit(
        tx,
        'tts:synthesize:org',
        args.organizationId,
        1,
      );
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        throw new TtsError(
          'RATE_LIMITED',
          'TTS rate limit exceeded for this organization.',
          429,
          error.retryAfter,
          { cause: error },
        );
      }
      throw error;
    }

    // Measured as the member is now — their teams and their role, so a
    // role's cap binds voice as it binds chat — and, in a project's thread,
    // against the project's caps too: reading its answers aloud is its spend.
    const projectId = await readThreadProjectId(
      tx,
      args.organizationId,
      args.threadId,
    );
    const subject = await loadBudgetSubject(tx, {
      organizationId: args.organizationId,
      userId: args.userId,
      ...(projectId !== undefined ? { projectIds: [projectId] } : {}),
    });
    // No lane books a team on a ledger row: a team's usage is its CURRENT
    // members' usage, read through membership by the budget gate — so this
    // lane no longer stamps one arbitrary team of a multi-team member.
    const prospectiveCostCents = estimateTtsCostCents(
      args.text.length,
      args.prospectiveCostCentsPerMChars ?? PROSPECTIVE_TTS_CENTS_PER_M_CHARS,
    );
    const violation = await findBudgetViolation(tx, subject, {
      reservations: await readInFlightReservations(
        tx,
        subject,
        existing !== undefined
          ? {
              tts: {
                chunkId: existing.id,
                attemptCreatedAt: existing.attemptCreatedAt,
              },
            }
          : {},
      ),
      prospectiveCostCents,
      prospectiveRequests: 1,
    });
    if (violation !== null) {
      throw new TtsError('BUDGET_EXCEEDED', violation.reason, 429);
    }

    // A failed retry can occur in the same millisecond. Its watchdog and
    // provider result must never match the attempt it replaces.
    const attemptCreatedAt = Math.max(
      Date.now(),
      (existing?.attemptCreatedAt ?? 0) + 1,
    );
    const projectIds = projectId !== undefined ? [projectId] : [];
    let chunkId: string;
    if (existing) {
      // Overwrite to retry: reset every result-bearing field, and reclaim a
      // blob a crashed attempt may have uploaded.
      if (existing.storageRef !== null) {
        await deleteOrgBlobRefs(tx, args.organizationId, [existing.storageRef]);
      }
      await tx`
        UPDATE app.tts_audio_chunks SET
          status = 'pending', error = NULL, text = ${args.text},
          locale = ${args.locale}, created_at_ms = ${attemptCreatedAt},
          attempt_created_at_ms = ${attemptCreatedAt},
          usage_recorded_at_ms = NULL, voice = NULL,
          provider_name = ${args.providerName ?? null},
          model_id = ${args.modelId ?? null}, format = NULL, storage_ref = NULL,
          character_count = NULL, cost_estimate_cents = NULL,
          reserved_cost_cents = ${prospectiveCostCents},
          project_ids = ${projectIds},
          user_id = ${args.userId}, team_id = NULL,
          agent_slug = ${args.agentSlug ?? tx.unsafe('agent_slug')}
        WHERE id = ${existing.id}
      `;
      chunkId = existing.id;
    } else {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO app.tts_audio_chunks (
          org_id, thread_id, message_id, user_id, team_id, agent_slug,
          chunk_index, text, status, locale, created_at_ms,
          attempt_created_at_ms, provider_name, model_id,
          reserved_cost_cents, project_ids
        ) VALUES (
          ${args.organizationId}, ${args.threadId}, ${args.messageId},
          ${args.userId}, NULL, ${args.agentSlug},
          ${args.index}, ${args.text}, 'pending', ${args.locale},
          ${attemptCreatedAt}, ${attemptCreatedAt},
          ${args.providerName ?? null}, ${args.modelId ?? null},
          ${prospectiveCostCents}, ${projectIds}
        )
        RETURNING id
      `;
      const id = inserted[0]?.id;
      if (!id) throw new Error('tts chunk insert failed');
      chunkId = id;
    }
    // The stuck-pending watchdog: if the provider call crashes after the
    // upload but before the settle, this flips the row to failed so the
    // player advances (identity-gated, so a settled attempt no-ops it).
    await addJobInTx(
      tx,
      'tts.watchdog_chunk',
      { chunkId, attemptCreatedAt },
      {
        startAfter: new Date(
          Date.now() + PENDING_STALE_MS + TTS_WATCHDOG_BUFFER_MS,
        ),
      },
    );
    return { kind: 'reserved', chunkId, attemptCreatedAt };
  });
}

// ----------------------------------------------------------------- settle

/** The caller holds this exact row through booking and release/replacement.
 * A durable reservation can have an unknown provider outcome; record its
 * saved estimate once rather than treating cancellation as free. This is
 * estimated usage, not a claim that the provider confirmed a charge. */
async function recordUnknownAttemptEstimate(
  tx: TransactionSql,
  row: ChunkRow,
  knownCostEstimateCents?: number,
): Promise<void> {
  // Previous writers did not persist a price. Never invent a legacy charge.
  if (row.usageRecordedAt !== null || row.reservedCostCents === null) return;
  const legacyProjectId =
    row.projectIds === null
      ? await readThreadProjectId(tx, row.organizationId, row.threadId)
      : undefined;
  const projectIds =
    row.projectIds ?? (legacyProjectId !== undefined ? [legacyProjectId] : []);
  const now = Date.now();
  const costEstimateCents = knownCostEstimateCents ?? row.reservedCostCents;
  await incrementUsageLedger(tx, {
    organizationId: row.organizationId,
    userId: row.userId,
    ...(row.teamId !== null ? { teamId: row.teamId } : {}),
    ...(projectIds.length > 0 ? { projectIds } : {}),
    agentSlug: TTS_SLUG,
    ...(row.modelId !== null ? { model: row.modelId } : {}),
    ...(row.providerName !== null ? { provider: row.providerName } : {}),
    inputTokens: 0,
    outputTokens: 0,
    costEstimateCents,
    characterCount: row.text.length,
    timestamp: now,
  });
  await tx`
    UPDATE app.tts_audio_chunks SET usage_recorded_at_ms = ${now},
      cost_estimate_cents = ${costEstimateCents},
      character_count = ${row.text.length}
    WHERE id = ${row.id} AND attempt_created_at_ms = ${row.attemptCreatedAt}
      AND usage_recorded_at_ms IS NULL
  `;
}

async function markChunkFailed(
  sql: Sql,
  args: {
    chunkId: string;
    attemptCreatedAt: number;
    error: string;
    knownCostEstimateCents?: number;
  },
): Promise<{ stale: boolean }> {
  if (!ERROR_CODES.has(args.error)) {
    // The closed vocabulary is the PII firewall — free-form text never
    // lands on a row every org member's subscription can read.
    throw new Error(`[tts] not a TtsErrorCode: ${args.error}`);
  }
  return sql.begin(async (tx) => {
    const rows = await tx<ChunkRow[]>`
      SELECT ${tx.unsafe(CHUNK_COLUMNS)} FROM app.tts_audio_chunks
      WHERE id = ${args.chunkId} AND status = 'pending'
        AND attempt_created_at_ms = ${args.attemptCreatedAt}
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { stale: true };
    await recordUnknownAttemptEstimate(tx, row, args.knownCostEstimateCents);
    await tx`
      UPDATE app.tts_audio_chunks SET status = 'failed', error = ${args.error}
      WHERE id = ${row.id}
    `;
    if (row.index === 0) {
      await addJobInTx(tx, 'tts.cleanup', { threadId: row.threadId });
    }
    return { stale: false };
  });
}

/** Also used by the real-PG budget/attempt proof; synthesis owns the app door. */
export async function markChunkReadyAndRecordUsage(
  sql: Sql,
  args: {
    chunkId: string;
    attemptCreatedAt: number;
    organizationId: string;
    storageRef: string;
    voice: string;
    providerName: string;
    modelId: string;
    format: string;
    characterCount: number;
    costEstimateCents: number;
  },
): Promise<{ stale: boolean }> {
  return sql.begin(async (tx) => {
    const rows = await tx<ChunkRow[]>`
      SELECT ${tx.unsafe(CHUNK_COLUMNS)} FROM app.tts_audio_chunks
      WHERE id = ${args.chunkId} AND org_id = ${args.organizationId}
        AND status = 'pending'
        AND attempt_created_at_ms = ${args.attemptCreatedAt}
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      // Stale attempt or vanished row — reclaim the incoming blob so it
      // doesn't leak (no other code path references it).
      await deleteOrgBlobRefs(tx, args.organizationId, [args.storageRef]);
      return { stale: true };
    }
    await tx`
      UPDATE app.tts_audio_chunks SET
        status = 'ready', storage_ref = ${args.storageRef},
        voice = ${args.voice}, provider_name = ${args.providerName},
        model_id = ${args.modelId}, format = ${args.format},
        character_count = ${args.characterCount},
        cost_estimate_cents = ${args.costEstimateCents}, error = NULL,
        usage_recorded_at_ms = ${Date.now()}
      WHERE id = ${row.id}
    `;
    // Ledger rows for TTS always bucket under the TTS_SLUG sentinel so
    // voice cost surfaces as its own row, never folded into the agent.
    // [] deliberately admitted no project. Only a legacy NULL stamp may
    // use the pre-reservation behavior of reading the thread at settlement.
    const legacyProjectId =
      row.projectIds === null
        ? await readThreadProjectId(tx, row.organizationId, row.threadId)
        : undefined;
    const projectIds =
      row.projectIds ??
      (legacyProjectId !== undefined ? [legacyProjectId] : []);
    await incrementUsageLedger(tx, {
      organizationId: row.organizationId,
      userId: row.userId,
      ...(row.teamId !== null ? { teamId: row.teamId } : {}),
      ...(projectIds.length > 0 ? { projectIds } : {}),
      agentSlug: TTS_SLUG,
      model: args.modelId,
      provider: args.providerName,
      inputTokens: 0,
      outputTokens: 0,
      costEstimateCents: args.costEstimateCents,
      characterCount: args.characterCount,
      timestamp: Date.now(),
    });
    if (row.index === 0) {
      await addJobInTx(tx, 'tts.cleanup', { threadId: row.threadId });
    }
    return { stale: false };
  });
}

// ------------------------------------------------------------- synthesize

/**
 * Is `messageId` a row of `threadId` (in this org)? Ownership of the thread is
 * checked by the caller (`loadOwnedThread`); this closes the remaining gap —
 * a message id is not secret (shared threads reveal them), so the thread it
 * is synthesized under must be the one it actually belongs to.
 */
async function messageBelongsToThread(
  sql: Sql,
  args: { organizationId: string; threadId: string; messageId: string },
): Promise<boolean> {
  const rows = await sql<{ one: number }[]>`
    SELECT 1 AS one FROM app.messages
    WHERE id = ${args.messageId} AND thread_id = ${args.threadId}
      AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export interface SynthesizeResult {
  status: 'ready' | 'in-flight' | 'failed';
  errorCode?: string;
  retryAfterMs?: number;
}

export async function synthesizeChunk(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    messageId: string;
    threadId: string;
    index: number;
    text: string;
    locale: string;
  },
): Promise<SynthesizeResult> {
  const text = args.text.trim();
  if (text.length === 0) {
    throw new TtsError('TTS_EMPTY_TEXT', 'Chunk text is empty after trim.');
  }
  if (text.length > MAX_TTS_CHUNK_CHARS) {
    throw new TtsError(
      'TTS_TEXT_TOO_LONG',
      `Chunk text exceeds ${MAX_TTS_CHUNK_CHARS} characters; client must re-segment.`,
    );
  }
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (!thread) {
    throw new TtsError('FORBIDDEN', 'This conversation does not exist.', 403);
  }
  if (!(await messageBelongsToThread(sql, args))) {
    // The caller owns the thread but names a message that is not in it — a
    // messageId learnt from another (shared, foreign) conversation. The
    // `(message_id, chunk_index)` reservation is global, so admitting this
    // would mint the row under the squatter's thread and lock the message's
    // real owner out of playback with a 403 and an audit row blaming THEM.
    await sql.begin(async (tx) => {
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.userId,
        actorType: 'user',
        action: 'tts.synthesize_denied',
        category: 'security',
        resourceType: 'tts_audio_chunk',
        metadata: {
          reason: 'message_not_in_thread',
          requestedMessageId: args.messageId,
          requestedThreadId: args.threadId,
        },
        status: 'denied',
      });
    });
    throw new TtsError(
      'FORBIDDEN',
      'This message does not belong to the conversation.',
      403,
    );
  }
  const meta = await sql<{ agentSlug: string | null }[]>`
    SELECT agent_slug AS "agentSlug" FROM app.thread_metadata
    WHERE thread_id = ${args.threadId} LIMIT 1
  `;

  // Resolve the model up front so the prospective budget check can use the
  // real per-model rate; a resolver failure has no chunk row to mark yet.
  const shim = createCtxShim(chatShimHandlers(sql));
  let modelData;
  try {
    modelData = await resolveTtsModel(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 resolver; every ctx facility it touches is covered by chatShimHandlers
      shim as unknown as Parameters<typeof resolveTtsModel>[0],
      { organizationId: args.organizationId, locale: args.locale },
    );
  } catch (error) {
    const { code } = errorCodeFromCaught(error);
    console.warn('[tts.synthesizeChunk] pre-reservation failure', {
      organizationId: args.organizationId,
      locale: args.locale,
      code,
      detail: sanitizeError(error),
    });
    return { status: 'failed', errorCode: code };
  }

  const reservation = await reserveChunk(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    messageId: args.messageId,
    threadId: args.threadId,
    index: args.index,
    text,
    locale: args.locale,
    agentSlug: meta[0]?.agentSlug ?? null,
    prospectiveCostCentsPerMChars: modelData.centsPerMillionCharacters,
    providerName: modelData.providerName,
    modelId: modelData.modelId,
  });
  if (reservation.kind === 'ready') return { status: 'ready' };
  if (reservation.kind === 'pending-in-flight') return { status: 'in-flight' };
  const { chunkId, attemptCreatedAt } = reservation;

  const markFailedAndReturn = async (
    code: TtsErrorCode,
    retryAfterMs?: number,
    knownCostEstimateCents?: number,
  ): Promise<SynthesizeResult> => {
    const result = await markChunkFailed(sql, {
      chunkId,
      attemptCreatedAt,
      error: code,
      ...(knownCostEstimateCents !== undefined
        ? { knownCostEstimateCents }
        : {}),
    });
    if (result.stale) return { status: 'in-flight' };
    return {
      status: 'failed',
      errorCode: code,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  };

  // Defense-in-depth: re-check host policy at synthesis time so a provider
  // file edited to point at an internal host cannot exfiltrate the token.
  try {
    checkProviderHostPolicy(modelData.baseUrl);
  } catch (error) {
    const { code } = errorCodeFromCaught(error);
    console.warn('[tts.synthesizeChunk] host policy rejected provider', {
      organizationId: args.organizationId,
      baseUrl: modelData.baseUrl,
      code,
      detail: sanitizeError(error),
    });
    return markFailedAndReturn(code);
  }

  const url = `${modelData.baseUrl.replace(/\/+$/, '')}/audio/speech`;
  const mime =
    AUDIO_MIME_BY_FORMAT[modelData.audioFormat] ?? 'application/octet-stream';
  let knownCostEstimateCents: number | undefined;
  try {
    const response = await safeFetchBinary(url, {
      allowPrivateAddresses: privateProviderHostsAllowed(),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${modelData.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/*',
      },
      body: JSON.stringify({
        model: modelData.modelId,
        input: text,
        voice: modelData.voice,
        response_format: modelData.audioFormat,
        ...(modelData.instructions
          ? { instructions: modelData.instructions }
          : {}),
      }),
      timeoutMs: TTS_FETCH_TIMEOUT_MS,
      maxResponseBytes: MAX_AUDIO_BYTES,
      defaultContentType: mime,
    });
    if (response.status < 200 || response.status >= 300) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers.get('Retry-After'),
      );
      console.warn('[tts] provider error', {
        status: response.status,
        chunkId,
        organizationId: args.organizationId,
        modelId: modelData.modelId,
      });
      throw new TtsProviderHttpError(
        response.status,
        retryAfterMs,
        `TTS API ${response.status}: provider call failed`,
      );
    }
    // The request succeeded; a later body/storage failure must not replace
    // its resolved rate with the admission fallback estimate.
    knownCostEstimateCents = estimateTtsCostCents(
      text.length,
      modelData.centsPerMillionCharacters,
    );
    if (response.body.size < MIN_TTS_AUDIO_BYTES) {
      console.warn('[tts] provider returned implausibly small body', {
        bytes: response.body.size,
        status: response.status,
      });
      throw new SafeFetchError(
        'response_too_small',
        `Provider returned ${response.body.size} bytes (< ${MIN_TTS_AUDIO_BYTES}); refusing empty audio`,
        response.status,
      );
    }
    const bytes = new Uint8Array(await response.body.arrayBuffer());
    const storageRef = await putOrgBlobBytes(sql, args.organizationId, {
      bytes,
      contentType: mime,
    });
    const settle = await markChunkReadyAndRecordUsage(sql, {
      chunkId,
      attemptCreatedAt,
      organizationId: args.organizationId,
      storageRef,
      voice: modelData.voice,
      providerName: modelData.providerName,
      modelId: modelData.modelId,
      format: modelData.audioFormat,
      characterCount: text.length,
      costEstimateCents: estimateTtsCostCents(
        text.length,
        modelData.centsPerMillionCharacters,
      ),
    });
    if (settle.stale) return { status: 'in-flight' };
    return { status: 'ready' };
  } catch (error) {
    const { code, retryAfterMs } = errorCodeFromCaught(error);
    console.warn('[tts] synthesis failed', {
      chunkId,
      code,
      detail: sanitizeError(error),
    });
    return markFailedAndReturn(code, retryAfterMs, knownCostEstimateCents);
  }
}

// ------------------------------------------------------------------ reads

export async function getMessageChunks(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    messageId: string;
    threadId: string;
  },
): Promise<
  {
    chunkId: string;
    index: number;
    status: string;
    voice?: string;
    format?: string;
    error?: string;
    text: string;
    createdAt: number;
  }[]
> {
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    args.threadId,
  );
  if (!thread) return [];
  const rows = await sql<ChunkRow[]>`
    SELECT ${sql.unsafe(CHUNK_COLUMNS)} FROM app.tts_audio_chunks
    WHERE message_id = ${args.messageId} AND thread_id = ${args.threadId}
      AND org_id = ${args.organizationId}
    ORDER BY chunk_index ASC
  `;
  return rows.map((row) => {
    const out: {
      chunkId: string;
      index: number;
      status: string;
      voice?: string;
      format?: string;
      error?: string;
      text: string;
      createdAt: number;
    } = {
      chunkId: row.id,
      index: row.index,
      status: row.status,
      text: row.text,
      createdAt: row.createdAt,
    };
    if (row.voice !== null) out.voice = row.voice;
    if (row.format !== null) out.format = row.format;
    if (row.error !== null) out.error = row.error;
    return out;
  });
}

/**
 * The audio-serve read. A chunk is spoken content of a PRIVATE conversation,
 * so the gate is the one every other TTS door uses — ownership of the chunk's
 * thread via `loadOwnedThread` — never org membership alone (a chunk id can
 * leak through logs or referers, and unguessability is not authorization).
 * Enforces readiness too; `null` covers missing, foreign, and not-ready alike.
 */
export async function getChunkForServe(
  sql: Sql,
  args: { organizationId: string; userId: string; chunkId: string },
): Promise<{ storageRef: string; contentType: string } | null> {
  const rows = await sql<
    {
      threadId: string;
      storageRef: string | null;
      status: string;
      format: string | null;
    }[]
  >`
    SELECT thread_id AS "threadId", storage_ref AS "storageRef", status, format
    FROM app.tts_audio_chunks
    WHERE id = ${args.chunkId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.status !== 'ready' || row.storageRef === null) return null;
  const thread = await loadOwnedThread(
    sql,
    args.organizationId,
    args.userId,
    row.threadId,
  );
  if (!thread) return null;
  const format = row.format;
  const mime =
    format !== null
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- format was written from the closed audioFormat union
        (AUDIO_MIME_BY_FORMAT[format as never] ?? 'application/octet-stream')
      : 'application/octet-stream';
  return { storageRef: row.storageRef, contentType: mime };
}

// ---------------------------------------------------------------- cleanup

/** Rate-gated lazy sweep of a thread's expired chunks (+ blobs). */
export async function runTtsCleanup(
  sql: Sql,
  payload: TaskPayloads['tts.cleanup'],
): Promise<void> {
  const gate = await limitRate(sql, 'cleanup:tts', {
    key: payload.threadId,
    count: 1,
  });
  if (!gate.ok) return;
  const cutoff = Date.now() - CHUNK_RETENTION_MS;
  const rows = await sql<
    { id: string; orgId: string; storageRef: string | null }[]
  >`
    SELECT id, org_id AS "orgId", storage_ref AS "storageRef"
    FROM app.tts_audio_chunks
    WHERE thread_id = ${payload.threadId} AND created_at_ms < ${cutoff}
      AND status <> 'pending'
    LIMIT ${CLEANUP_PASS_LIMIT}
  `;
  for (const row of rows) {
    await sql.begin(async (tx) => {
      const deleted = await tx<{ storageRef: string | null }[]>`
        DELETE FROM app.tts_audio_chunks
        WHERE id = ${row.id} AND org_id = ${row.orgId}
          AND created_at_ms < ${cutoff}
          AND status <> 'pending'
        RETURNING storage_ref AS "storageRef"
      `;
      const removed = deleted[0];
      if (removed?.storageRef != null) {
        await deleteOrgBlobRefs(tx, row.orgId, [removed.storageRef]);
      }
    });
  }
}

/**
 * The fleet-wide chunk GC — the 0.5 twin of 0.4's `gcOrgTtsChunks` hourly
 * cron, and the defence-in-depth the per-thread cleanup leans on: every
 * cascade that deletes messages directly relies on SOMETHING eventually
 * collecting the chunks it could not reach.
 *
 * Rule 5: 0.4 walked orgs behind a persisted cursor because a Convex
 * mutation could not scan the table. Here the retention cutoff IS the query;
 * a single bounded pass takes the oldest expired rows across the fleet, and
 * the next tick takes the next page. No cursor row, no wrap-around
 * bookkeeping, same bound on work per run.
 */
export async function gcExpiredTtsChunks(
  sql: Sql,
  options: { limit?: number; now?: number } = {},
): Promise<{ deleted: number }> {
  const cutoff = (options.now ?? Date.now()) - CHUNK_RETENTION_MS;
  const rows = await sql<
    { id: string; orgId: string; storageRef: string | null }[]
  >`
    SELECT id, org_id AS "orgId", storage_ref AS "storageRef"
    FROM app.tts_audio_chunks
    WHERE created_at_ms < ${cutoff} AND status <> 'pending'
    ORDER BY created_at_ms
    LIMIT ${options.limit ?? 500}
  `;
  let deleted = 0;
  for (const row of rows) {
    // Row-then-blob, one transaction each: a storage failure must not roll
    // back a batch, and a row that survives its blob is the recoverable
    // direction (the next tick retries it).
    try {
      const removed = await sql.begin(async (tx) => {
        const deletedRows = await tx<{ storageRef: string | null }[]>`
          DELETE FROM app.tts_audio_chunks
          WHERE id = ${row.id} AND org_id = ${row.orgId}
            AND created_at_ms < ${cutoff}
            AND status <> 'pending'
          RETURNING storage_ref AS "storageRef"
        `;
        const chunk = deletedRows[0];
        if (chunk?.storageRef != null) {
          await deleteOrgBlobRefs(tx, row.orgId, [chunk.storageRef]);
        }
        return chunk !== undefined;
      });
      if (removed) deleted += 1;
    } catch (error) {
      console.warn('[tts] chunk GC failed for one row:', error);
    }
  }
  if (deleted > 0) {
    console.info(`[tts] GC removed ${deleted} expired audio chunk(s)`);
  }
  return { deleted };
}

/** The watchdog job body: identity-gated failed flip for stuck pendings. */
export async function runTtsWatchdog(
  sql: Sql,
  payload: TaskPayloads['tts.watchdog_chunk'],
): Promise<void> {
  await markChunkFailed(sql, {
    chunkId: payload.chunkId,
    attemptCreatedAt: payload.attemptCreatedAt,
    error: 'WATCHDOG_TIMEOUT',
  });
}

/** Thread-purge cascade: delete every chunk (+ blob) the thread holds —
 * wired into the chat lineage purge so voice artifacts die with the
 * conversation. */
export async function cascadeDeleteThreadTtsChunks(
  tx: TransactionSql,
  organizationId: string,
  threadId: string,
): Promise<void> {
  const rows = await tx<{ id: string; storageRef: string | null }[]>`
    SELECT id, storage_ref AS "storageRef" FROM app.tts_audio_chunks
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
  `;
  for (const row of rows) {
    if (row.storageRef !== null) {
      await deleteOrgBlobRefs(tx, organizationId, [row.storageRef]);
    }
  }
  await tx`
    DELETE FROM app.tts_audio_chunks
    WHERE thread_id = ${threadId} AND org_id = ${organizationId}
  `;
}
