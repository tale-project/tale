import type { Sql, TransactionSql } from 'postgres';

import {
  AUTOMATION_SUBJECT_ID,
  isAutomationSubject,
} from '../../../lib/shared/constants/usage.ts';
import type { GatewaySpendReading } from '../../core/node_only/sandbox/gateway_key_settlement.ts';
import {
  readVirtualKeySpend,
  setVirtualKeyBudget,
} from '../../core/node_only/sandbox/llm_gateway_admin.ts';
import { workflowAgentBudgetCents } from '../../core/sandbox/agent_deadline.ts';
import {
  SANDBOX_IMAGE_CALL_STALE_MS,
  SANDBOX_IMAGE_HOLD_CENTS,
  SANDBOX_TURN_MAX_GENERATED_IMAGES,
} from '../../core/sandbox/session_constants.ts';
import type { ShimHandlers } from '../../lib/ctx-shim.ts';
import {
  findBudgetViolation,
  loadBudgetSubject,
  type OrgBudgetSubject,
} from '../governance/budget-gate.ts';
import { budgetRefusalMessage } from '../governance/budget-refusal.ts';
import {
  lockBudgetAdmission,
  readInFlightReservations,
} from '../governance/budget-reservations.ts';
import { incrementUsageLedger } from '../governance/service.ts';
import {
  resolveSessionOpAttribution,
  type SessionOpAttribution,
} from './op-attribution.ts';

/**
 * The Postgres side of the `generate_image` workspace tool
 * (`core/node_only/sandbox/workspace_image_tool.ts`): whose turn a call
 * belongs to, the admission that runs before any provider call, and the
 * settle that books what the call cost — the seams the tool dispatch
 * reaches through the sandbox tool shim.
 *
 * The person is the run's starter, read through the one resolver the
 * managed turns book their own spend with (`resolveSessionOpAttribution`),
 * so a turn's images and its tokens land under the same person and agent
 * (`domains/governance/README.md`); a run a trigger started books under
 * `__automation__`.
 *
 * A turn's image spend is bounded three ways, all decided on its op row
 * under the organization's budget-admission lock: the turn's own spend
 * allowance (what its gateway key was minted with, shared with the model
 * spend the key reports), a ceiling on the images one turn may create, and
 * the organization's budget caps — against which a generation in flight
 * holds its estimate like every other piece of work in flight.
 *
 * The allowance is shared both ways. Images must fit in what the model has
 * left, and the model must not spend what the images took: the key's own
 * cap gives up an image's hold when it is admitted and its cost when it is
 * booked. Without that a turn whose images came first could still spend its
 * whole allowance on the model — twice the allowance in all.
 */

/** The billing subject of one generation, as the tool carries it. */
export interface ImageSubject {
  userId: string;
  agentSlug?: string;
  apiKeyId?: string;
}

export type ImageTurnContext =
  | { status: 'live'; outputDir: string; subject: ImageSubject }
  | { status: 'ended' };

function subjectOf(attribution: SessionOpAttribution | null): ImageSubject {
  if (attribution === null || attribution.userId === '') {
    // No person started this work: the spend is nobody's, booked under the
    // sentinel and measured against the organization's caps alone.
    return { userId: AUTOMATION_SUBJECT_ID };
  }
  return {
    userId: attribution.userId,
    ...(attribution.agentSlug !== undefined
      ? { agentSlug: attribution.agentSlug }
      : {}),
    ...(attribution.apiKeyId !== undefined
      ? { apiKeyId: attribution.apiKeyId }
      : {}),
  };
}

/**
 * The turn a token names, if it is still running: a task run must be live
 * on that exec (queued or running) and delivers into its task's own box; an
 * automation agent step's op must still be running and delivers into the
 * run's `/agent/output`. Anything else has ended — a token that outlives its
 * run generates nothing.
 */
export async function resolveImageTurnContext(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    sessionId: string;
    kind: 'task-agent' | 'workflow-agent';
    execId: string;
  },
): Promise<ImageTurnContext> {
  let outputDir: string;
  if (args.kind === 'task-agent') {
    const runs = await sql<{ taskId: string }[]>`
      SELECT task_id AS "taskId"
      FROM app.project_agent_runs
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
        AND status IN ('queued', 'running')
      ORDER BY seq DESC
      LIMIT 1
    `;
    const run = runs[0];
    if (run === undefined) return { status: 'ended' };
    outputDir = `/agent/output/${run.taskId}`;
  } else {
    const ops = await sql<{ id: string }[]>`
      SELECT id
      FROM app.sandbox_session_ops
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
        AND kind = 'workflow-agent'
        AND status = 'running'
        AND finalized_at_ms IS NULL
      LIMIT 1
    `;
    if (ops.length === 0) return { status: 'ended' };
    outputDir = '/agent/output';
  }
  const attribution = await resolveSessionOpAttribution(sql, args);
  return { status: 'live', outputDir, subject: subjectOf(attribution) };
}

/** Why a generation was not admitted. */
export type ImageRefusalCode =
  /** The turn's op is gone or no longer running. */
  | 'run_ended'
  /** Another generation of the same turn is still running. */
  | 'generation_in_progress'
  /** The turn has created as many images as one turn may. */
  | 'turn_image_limit'
  /** The turn's spend allowance has no room for the images asked for. */
  | 'turn_allowance'
  /** The turn's model spend could not be read, so its room is unknown. */
  | 'spend_unknown'
  /** A budget cap that binds the turn's person (or organization). */
  | 'budget_exceeded';

export type ImageAdmission =
  | {
      admitted: true;
      /** The admission's own mark on the op row, which the settle names. */
      callStartedAt: number;
      holdCents: number;
    }
  | { admitted: false; code: ImageRefusalCode; message: string };

function refused(code: ImageRefusalCode, message: string): ImageAdmission {
  return { admitted: false, code, message };
}

interface OpImageState {
  id: string;
  status: string;
  finalized: boolean;
  mintedKeyId: string | null;
  budgetCents: number | null;
  callStartedAt: number | null;
  imagesAdmitted: number;
  imageSpentCents: number;
}

/** The turn's op row as the admission reads it; `null` once the turn is
 * no longer running. */
function liveOp(rows: OpImageState[]): OpImageState | null {
  const op = rows[0];
  if (op === undefined || op.status !== 'running' || op.finalized) return null;
  return op;
}

/** Read without a lock, for the figures fetched before the admission. */
async function peekOp(
  sql: Sql,
  args: { organizationId: string; sessionId: string; execId: string },
): Promise<OpImageState | null> {
  return liveOp(
    await sql<OpImageState[]>`
      SELECT id, status, finalized_at_ms IS NOT NULL AS finalized,
             minted_key_id AS "mintedKeyId",
             budget_cents::float8 AS "budgetCents",
             image_call_started_at_ms::float8 AS "callStartedAt",
             images_admitted AS "imagesAdmitted",
             image_spent_cents::float8 AS "imageSpentCents"
      FROM app.sandbox_session_ops
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
      LIMIT 1
    `,
  );
}

/** Read and lock the op row inside the admission. */
async function lockOp(
  tx: TransactionSql,
  id: string,
): Promise<OpImageState | null> {
  return liveOp(
    await tx<OpImageState[]>`
      SELECT id, status, finalized_at_ms IS NOT NULL AS finalized,
             minted_key_id AS "mintedKeyId",
             budget_cents::float8 AS "budgetCents",
             image_call_started_at_ms::float8 AS "callStartedAt",
             images_admitted AS "imagesAdmitted",
             image_spent_cents::float8 AS "imageSpentCents"
      FROM app.sandbox_session_ops
      WHERE id = ${id}
      FOR UPDATE
    `,
  );
}

/** The subject a budget cap measures: the person as they are now (teams,
 * role), or for nobody's spend the organization's caps and the key's. */
async function budgetSubjectOf(
  sql: Sql | TransactionSql,
  organizationId: string,
  subject: ImageSubject,
): Promise<OrgBudgetSubject> {
  const apiKey =
    subject.apiKeyId !== undefined ? { apiKeyId: subject.apiKeyId } : {};
  return subject.userId === '' || isAutomationSubject(subject.userId)
    ? {
        organizationId,
        userId: subject.userId,
        userTeamIds: [],
        impersonal: true,
        ...apiKey,
      }
    : loadBudgetSubject(sql, {
        organizationId,
        userId: subject.userId,
        ...apiKey,
      });
}

function cents(value: number): string {
  return `${Math.round(value * 100) / 100} cents`;
}

/**
 * Admit `images` generations for one turn, or say why not — before any
 * provider is called. In order: the turn must still be running and have no
 * other generation in flight; the images must fit under the per-turn
 * ceiling; their estimate must fit in what the turn's allowance has left
 * after its model spend (read live from the gateway, the figure the key's
 * own cap is enforced on) and its earlier images; and it must fit under
 * every budget cap that binds the turn's person, counting everything in
 * flight — this turn's own allowance included, since its model may still
 * spend all of it. An admitted call leaves its estimate on the op row as a
 * hold, which every later admission counts, until the settle books the real
 * cost in its place.
 *
 * A turn on a vendor subscription has no gateway key: its model spend is
 * the vendor's, and its images are measured against the deployment's
 * default allowance.
 */
export async function admitImageGeneration(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    subject: ImageSubject;
    images: number;
  },
  deps: {
    readKeySpend?: (keyId: string) => Promise<GatewaySpendReading>;
    setKeyBudget?: (keyId: string, cents: number) => Promise<'ok' | 'gone'>;
    now?: () => number;
  } = {},
): Promise<ImageAdmission> {
  const readKeySpend = deps.readKeySpend ?? readVirtualKeySpend;
  const setKeyBudget = deps.setKeyBudget ?? setVirtualKeyBudget;
  const now = deps.now ?? Date.now;
  const ended = refused(
    'run_ended',
    'The turn this call belongs to is no longer running.',
  );
  // The model spend is a gateway read: taken before the lock, so no other
  // admission of the organization waits on a remote call. It only grows,
  // and the key's own cap bounds it, so a figure a moment old is safe.
  const before = await peekOp(sql, args);
  if (before === null) return ended;
  let modelSpentCents = 0;
  if (before.mintedKeyId !== null) {
    const reading = await readKeySpend(before.mintedKeyId);
    if (reading.status === 'gone') return ended;
    if (reading.status === 'unavailable' || reading.unmetered === true) {
      return refused(
        'spend_unknown',
        'The platform cannot read what this turn has spent so far, so it cannot tell whether the images fit its spend allowance.',
      );
    }
    modelSpentCents = reading.cents;
  }
  const holdCents = args.images * SANDBOX_IMAGE_HOLD_CENTS;
  const decided = await sql.begin(async (tx) => {
    // The lock every budget admission of the organization takes (chat
    // turns, managed turns, other generations), before the op row's own.
    await lockBudgetAdmission(tx, args.organizationId);
    const op = await lockOp(tx, before.id);
    if (op === null) return ended;
    const startedAt = now();
    if (
      op.callStartedAt !== null &&
      startedAt - op.callStartedAt < SANDBOX_IMAGE_CALL_STALE_MS
    ) {
      return refused(
        'generation_in_progress',
        'Another image generation of this turn is still running.',
      );
    }
    const left = SANDBOX_TURN_MAX_GENERATED_IMAGES - op.imagesAdmitted;
    if (args.images > left) {
      return refused(
        'turn_image_limit',
        left <= 0
          ? `This turn has created the ${SANDBOX_TURN_MAX_GENERATED_IMAGES} images one turn may create.`
          : `This turn may create ${left} more ${left === 1 ? 'image' : 'images'} (${SANDBOX_TURN_MAX_GENERATED_IMAGES} per turn), not ${args.images}.`,
      );
    }
    const allowance = op.budgetCents ?? workflowAgentBudgetCents();
    const room = allowance - modelSpentCents - op.imageSpentCents;
    if (holdCents > room) {
      return refused(
        'turn_allowance',
        `This turn's spend allowance has ${cents(Math.max(0, room))} left, and ${args.images === 1 ? 'an image is' : `${args.images} images are`} held at ${cents(holdCents)} until ${args.images === 1 ? 'its' : 'their'} cost is known.`,
      );
    }
    const subject = await budgetSubjectOf(
      tx,
      args.organizationId,
      args.subject,
    );
    const violation = await findBudgetViolation(tx, subject, {
      // Every hold in flight — this turn's own allowance too: its model may
      // still spend all of it, so an image must fit beside it, not in it.
      reservations: await readInFlightReservations(tx, subject),
      prospectiveCostCents: holdCents,
      // The gate refuses at `used + prospective >= cap`, the first image
      // being the request it measures: room for N images is N - 1 more.
      prospectiveRequests: Math.max(0, args.images - 1),
    });
    if (violation !== null) {
      return refused('budget_exceeded', budgetRefusalMessage(violation));
    }
    await tx`
      UPDATE app.sandbox_session_ops SET
        image_call_started_at_ms = ${startedAt},
        image_hold_cents = ${holdCents},
        image_hold_requests = ${args.images},
        images_admitted = images_admitted + ${args.images},
        user_id = coalesce(user_id, ${args.subject.userId === '' ? null : args.subject.userId})
      WHERE id = ${op.id}
    `;
    const admission: ImageAdmission = {
      admitted: true,
      callStartedAt: startedAt,
      holdCents,
    };
    return {
      admission,
      opId: op.id,
      // What the model may still spend once these images are held.
      keyCapCents: allowance - op.imageSpentCents - holdCents,
    };
  });
  if ('admitted' in decided) return decided;
  const { admission, opId, keyCapCents } = decided;
  if (before.mintedKeyId === null || !admission.admitted) return admission;
  // The images' hold leaves the key's cap before any provider is called: a
  // cap the gateway would not move could let the model spend it as well,
  // so the images wait for a turn whose cap can be read and moved.
  let moved: 'ok' | 'gone' | 'failed';
  try {
    moved = await setKeyBudget(before.mintedKeyId, keyCapCents);
  } catch (error) {
    console.warn(
      `[image-generation] could not set the turn's key cap aside for its images (op ${opId}):`,
      error,
    );
    moved = 'failed';
  }
  if (moved === 'ok') return admission;
  await withdrawAdmission(sql, opId, admission.callStartedAt, args.images);
  return moved === 'gone'
    ? ended
    : refused(
        'spend_unknown',
        "The platform could not set the images' cost aside from this turn's spend allowance, so it cannot generate them now.",
      );
}

/** Take back an admission whose hold could not leave the key's cap: its
 * mark, its hold, and the images it counted. A mark a newer call has taken
 * over is left alone. */
async function withdrawAdmission(
  sql: Sql,
  opId: string,
  callStartedAt: number,
  images: number,
): Promise<void> {
  await sql`
    UPDATE app.sandbox_session_ops SET
      image_call_started_at_ms = NULL,
      image_hold_cents = 0,
      image_hold_requests = 0,
      images_admitted = greatest(0, images_admitted - ${images})
    WHERE id = ${opId} AND image_call_started_at_ms = ${callStartedAt}
  `;
}

/**
 * Book what an admitted call cost and release its hold, in one transaction,
 * so there is no moment the spend counts as neither a hold nor usage. Every
 * charged request is one ledger row under the turn's person and agent — a
 * request the provider billed without returning a usable image included —
 * with the cost it reported (or its catalog price) and no tokens: image
 * generation is measured in cost and requests, not text tokens. The cost
 * also joins the turn's image spend, which its allowance is measured
 * against. The hold is released only if it is still this call's: a call
 * whose mark was taken over as stale leaves the newer one alone.
 */
export async function settleImageGeneration(
  sql: Sql,
  args: {
    organizationId: string;
    sessionId: string;
    execId: string;
    callStartedAt: number;
    subject: ImageSubject;
    provider: string;
    model: string;
    /** One entry per charged request: its cost in cents. */
    charges: number[];
    timestamp: number;
  },
  deps: {
    setKeyBudget?: (keyId: string, cents: number) => Promise<'ok' | 'gone'>;
  } = {},
): Promise<void> {
  const setKeyBudget = deps.setKeyBudget ?? setVirtualKeyBudget;
  const spent = args.charges.reduce((sum, charge) => sum + charge, 0);
  const settled = await sql.begin(async (tx) => {
    for (const costCents of args.charges) {
      await incrementUsageLedger(tx, {
        organizationId: args.organizationId,
        userId: args.subject.userId,
        ...(args.subject.agentSlug !== undefined
          ? { agentSlug: args.subject.agentSlug }
          : {}),
        ...(args.subject.apiKeyId !== undefined
          ? { apiKeyId: args.subject.apiKeyId }
          : {}),
        provider: args.provider,
        model: args.model,
        inputTokens: 0,
        outputTokens: 0,
        costEstimateCents: costCents,
        timestamp: args.timestamp,
      });
    }
    return tx<
      {
        mintedKeyId: string | null;
        budgetCents: number | null;
        imageSpentCents: number;
        imageHoldCents: number;
      }[]
    >`
      UPDATE app.sandbox_session_ops SET
        image_spent_cents = image_spent_cents + ${spent},
        image_hold_cents = CASE
          WHEN image_call_started_at_ms = ${args.callStartedAt} THEN 0
          ELSE image_hold_cents END,
        image_hold_requests = CASE
          WHEN image_call_started_at_ms = ${args.callStartedAt} THEN 0
          ELSE image_hold_requests END,
        image_call_started_at_ms = CASE
          WHEN image_call_started_at_ms = ${args.callStartedAt} THEN NULL
          ELSE image_call_started_at_ms END
      WHERE org_id = ${args.organizationId}
        AND session_id = ${args.sessionId}
        AND exec_id = ${args.execId}
      RETURNING minted_key_id AS "mintedKeyId",
                budget_cents::float8 AS "budgetCents",
                image_spent_cents::float8 AS "imageSpentCents",
                image_hold_cents::float8 AS "imageHoldCents"
    `;
  });
  const op = settled[0];
  if (op === undefined || op.mintedKeyId === null) return;
  // The booked cost takes the hold's place in the key's cap: what the model
  // may still spend is the allowance less every image booked or still held.
  const capCents =
    (op.budgetCents ?? workflowAgentBudgetCents()) -
    op.imageSpentCents -
    op.imageHoldCents;
  try {
    await setKeyBudget(op.mintedKeyId, capCents);
  } catch (error) {
    // The images are paid and booked either way; the cap keeps the hold's
    // figure, which a cost within the estimate never undercuts.
    console.warn(
      `[image-generation] could not move the turn's key cap to its booked image spend (exec ${args.execId}):`,
      error,
    );
  }
}

/** The three seams, by the names the tool dispatch addresses them with. */
export function imageGenerationShimHandlers(sql: Sql): ShimHandlers {
  return {
    'sandbox/image_generation:getImageTurnContext': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof resolveImageTurnContext>[1];
      return resolveImageTurnContext(sql, args);
    },
    'sandbox/image_generation:admitImageGeneration': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof admitImageGeneration>[1];
      return admitImageGeneration(sql, args);
    },
    'sandbox/image_generation:settleImageGeneration': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the tool passes exactly this shape
      const args = raw as Parameters<typeof settleImageGeneration>[1];
      await settleImageGeneration(sql, args);
      return null;
    },
  };
}
