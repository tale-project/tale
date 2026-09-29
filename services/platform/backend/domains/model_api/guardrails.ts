import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  type GuardrailChainOptions,
  type GuardrailFilter,
  runGuardrailChain,
} from '../../../lib/chat/guardrails.ts';
import { refusalReason } from '../../../lib/chat/turn.ts';
import { MAX_MESSAGE_BYTES } from '../../../lib/pii/core/regex-safety.ts';
import { DIRECT_API_AGENT_SLUG } from '../../../lib/shared/constants/usage.ts';
import {
  buildTurnGuardrails,
  type TurnPolicies,
} from '../../core/chat/guardrails.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { readGovernancePolicy } from '../../lib/org-config.ts';
import { governanceShimHandlers } from '../governance/shim.ts';
import {
  MAX_TEXT_SEGMENTS,
  ModelApiRefusal,
  type TextSegment,
  type WireRequest,
} from './wire.ts';

/**
 * The organization's INPUT guardrails on a model-endpoint request — the
 * chain a chat turn runs on what a person sends (`chat_filter` → PII →
 * moderation provider, built from the same policy files by the same code,
 * `core/chat/guardrails.ts`), applied to EVERY stretch of caller text in
 * the request before it is relayed: on this surface the caller writes the
 * system prompt, the person's turns, the assistant's, the tool results and
 * the tool definitions alike, so all of it is judged (the wire readers
 * collect it).
 *
 *  - a BLOCK refuses the request (400 `MODEL_API_GUARDRAIL_BLOCKED`, the chat
 *    turn's own sentence), and a step that FAILS under a fail-closed policy
 *    refuses it too (503 `MODEL_API_GUARDRAIL_UNAVAILABLE`);
 *  - a MASK rewrites the text in the relayed body, so the model sees what a
 *    chat turn's model would — except where the text is an identifier (a
 *    tool's name, a signed reasoning block): rewriting that would break the
 *    request, so a mask there refuses it instead;
 *  - a PII policy in TOKENIZE mode is refused outright (403
 *    `MODEL_API_GUARDRAIL_UNSUPPORTED`): it swaps personal data for tokens
 *    and puts it back into the reply, a round trip a relayed reply never
 *    makes — relaying the tokens, or the data unmasked, would each be a
 *    silent departure from the organization's policy;
 *  - the policies are read the way an authorization policy is: a file that
 *    exists but cannot be read, or a PII policy that cannot be built, shuts
 *    the door (503) rather than relaying the text unjudged.
 *
 * The OUTPUT is not filtered: the model's answer, streamed or not, reaches
 * the caller as the model sent it. Images and binary documents are relayed
 * unread.
 *
 * The cost of judging is bounded per request and across requests:
 *  - a request carries at most {@link MAX_SCANNED_TEXT_BYTES} of text (and
 *    {@link MAX_TEXT_SEGMENTS} stretches of it) while guardrails are on —
 *    past that it is refused (413 `MODEL_API_TEXT_TOO_LARGE`);
 *  - a stateless wire resends the whole conversation every time, so a
 *    verdict is remembered per organization, per policy version and per
 *    exact text for a few minutes — kept as a hash and the verdict, with a
 *    masked text only when it is small, the whole memory bounded by bytes;
 *    a block or a failure is never remembered;
 *  - the texts still to judge are joined into units of up to the chain's
 *    own scan limit (`MAX_MESSAGE_BYTES`), so a request of many short texts
 *    costs a handful of chain runs — and of moderation provider calls, at
 *    most {@link MAX_CHAIN_RUNS} per request; the first paid call waits for
 *    a read of the caller's budgets (`beforePaidCall`), so a caller over a
 *    cap does not run up the provider's bill either;
 *  - a text longer than the scan limit is judged in pieces cut at line
 *    breaks (the filters stop reading past the limit, and a mask rebuilds
 *    only what they read).
 */

/** How long a text's verdict is reused. */
const VERDICT_TTL_MS = 10 * 60_000;
/** What the remembered verdicts may take in memory, in all. */
const MAX_VERDICT_MEMORY_BYTES = 16 * 1024 * 1024;
/** The largest masked text kept for reuse; a larger one is judged again. */
const MAX_REMEMBERED_MASK_BYTES = 64 * 1024;
/** How many verdicts the process keeps, oldest dropped first. */
const MAX_VERDICTS = 20_000;
/** A verdict's own weight beside its masked text: the key, the entry. */
const VERDICT_OVERHEAD_BYTES = 160;
/** The most caller text one request may carry while guardrails are on. */
export const MAX_SCANNED_TEXT_BYTES = 2 * 1024 * 1024;
/** The most chain runs (each one moderation provider call at most) one
 * request may cost. */
export const MAX_CHAIN_RUNS = 64;

interface Verdict {
  at: number;
  /** The text as the chain left it, when it changed it; absent for a pass. */
  masked?: string;
  bytes: number;
}

const verdicts = new Map<string, Verdict>();
let verdictMemoryBytes = 0;

/** Test seam: forget every remembered verdict. */
export function resetGuardrailVerdictsForTests(): void {
  verdicts.clear();
  verdictMemoryBytes = 0;
}

/** Test seam: what the remembered verdicts hold. */
export function guardrailVerdictMemoryForTests(): {
  count: number;
  bytes: number;
} {
  return { count: verdicts.size, bytes: verdictMemoryBytes };
}

function forgetVerdict(key: string): void {
  const verdict = verdicts.get(key);
  if (verdict === undefined) return;
  verdicts.delete(key);
  verdictMemoryBytes -= verdict.bytes;
}

function rememberVerdict(
  key: string,
  masked: string | undefined,
  now: number,
): void {
  forgetVerdict(key);
  const maskedBytes = masked === undefined ? 0 : masked.length * 2;
  if (maskedBytes > MAX_REMEMBERED_MASK_BYTES) return;
  const bytes = VERDICT_OVERHEAD_BYTES + maskedBytes;
  verdicts.set(key, {
    at: now,
    ...(masked !== undefined ? { masked } : {}),
    bytes,
  });
  verdictMemoryBytes += bytes;
  while (
    verdictMemoryBytes > MAX_VERDICT_MEMORY_BYTES ||
    verdicts.size > MAX_VERDICTS
  ) {
    const oldest = verdicts.keys().next();
    if (oldest.done === true) break;
    forgetVerdict(oldest.value);
  }
}

function recalledVerdict(key: string, now: number): Verdict | undefined {
  const verdict = verdicts.get(key);
  if (verdict === undefined) return undefined;
  if (now - verdict.at > VERDICT_TTL_MS) {
    forgetVerdict(key);
    return undefined;
  }
  return verdict;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The policy version a verdict belongs to: any change to the three input
 * policies starts over. */
function policyFingerprint(policies: TurnPolicies): string {
  return sha256(
    JSON.stringify([policies.chatFilter, policies.pii, policies.moderation]),
  );
}

/** A piece's byte budget: the chain's scan limit. */
const PIECE_BYTES = MAX_MESSAGE_BYTES;

/** UTF-8 size of one code point. */
function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * `text` cut into pieces of at most {@link PIECE_BYTES} UTF-8 bytes, each
 * ending at a line break where one falls inside the budget, else at the last
 * space, else at the budget itself (never inside a surrogate pair). Joined,
 * the pieces are the text. One pass over the text: a cut re-reads only the
 * tail it carries into the next piece, which is within the budget.
 */
export function piecesForScan(text: string, maxBytes = PIECE_BYTES): string[] {
  // A UTF-16 unit is at most three UTF-8 bytes (a pair, four for two).
  if (text.length * 3 <= maxBytes) return [text];
  const pieces: string[] = [];
  let start = 0;
  let bytes = 0;
  let lastBreak = -1;
  let lastSpace = -1;
  let index = 0;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const units = codePoint > 0xffff ? 2 : 1;
    const size = utf8Size(codePoint);
    if (bytes + size > maxBytes && index > start) {
      const cut =
        lastBreak > start ? lastBreak : lastSpace > start ? lastSpace : index;
      pieces.push(text.slice(start, cut));
      start = cut;
      bytes = 0;
      lastBreak = -1;
      lastSpace = -1;
      // Re-read the carried tail (within the budget) for its size and cut
      // points.
      let tail = cut;
      while (tail < index) {
        const tailPoint = text.codePointAt(tail) ?? 0;
        bytes += utf8Size(tailPoint);
        tail += tailPoint > 0xffff ? 2 : 1;
        if (tailPoint === 10) lastBreak = tail;
        else if (tailPoint === 32) lastSpace = tail;
      }
      continue;
    }
    bytes += size;
    index += units;
    if (codePoint === 10) lastBreak = index;
    else if (codePoint === 32) lastSpace = index;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/** Joins the texts of one unit. Newlines around invisible separators, so no
 * pattern that reads within a line or a word can match across two texts,
 * and no mask of a word or a value reaches it. */
const UNIT_SEPARATOR = '\n\u2063\u2063\u2063\n';
const UNIT_SEPARATOR_BYTES = Buffer.byteLength(UNIT_SEPARATOR);

export interface ModelApiGuardrails {
  /** Judge every text of the request in place: masks are written back; a
   * block, a fail-closed failure, a mask on an identifier or too much text
   * throws the refusal. */
  apply(request: WireRequest): Promise<void>;
}

/** Where the text a refusal is about sits, in the refusal's words. */
function placeOf(segments: readonly TextSegment[]): string {
  const places = new Set(segments.map((segment) => segment.where));
  const [only] = places;
  return places.size === 1 && only !== undefined ? only : 'text';
}

function refusalFor(
  refusal: NonNullable<
    Awaited<ReturnType<typeof runGuardrailChain>>['refusal']
  >,
  where: string,
): ModelApiRefusal {
  if (refusal.stepError !== undefined) {
    return new ModelApiRefusal(
      503,
      'MODEL_API_GUARDRAIL_UNAVAILABLE',
      `${refusalReason(refusal)} The request's ${where} was not relayed; try again later.`,
    );
  }
  return new ModelApiRefusal(
    400,
    'MODEL_API_GUARDRAIL_BLOCKED',
    `${refusalReason(refusal)} The organization's guardrails refused the request's ${where}; nothing was sent to the model.`,
  );
}

function textTooLarge(message: string): ModelApiRefusal {
  return new ModelApiRefusal(413, 'MODEL_API_TEXT_TOO_LARGE', message);
}

function unavailable(message: string): ModelApiRefusal {
  return new ModelApiRefusal(503, 'MODEL_API_GUARDRAIL_UNAVAILABLE', message, {
    headers: { 'retry-after': '30' },
  });
}

/** The three input policies, read strictly: a file that exists but cannot
 * be read throws. */
async function readInputPolicies(orgSlug: string): Promise<TurnPolicies> {
  const [chatFilter, pii, moderation] = await Promise.all([
    readGovernancePolicy(orgSlug, 'chat_filter', { strict: true }),
    readGovernancePolicy(orgSlug, 'pii_config', { strict: true }),
    readGovernancePolicy(orgSlug, 'moderation_provider', { strict: true }),
  ]);
  return { chatFilter, pii, moderation, systemPrompt: null };
}

/** One text still to judge, and every segment of the request carrying it. */
interface Pending {
  key: string;
  text: string;
  segments: TextSegment[];
}

/** Put a verdict on the segments that carry its text: a pass leaves them,
 * a mask rewrites them — or refuses, where the text is an identifier. */
function applyVerdict(
  segments: readonly TextSegment[],
  text: string,
  masked: string | undefined,
): void {
  if (masked === undefined || masked === text) return;
  for (const segment of segments) {
    if (!segment.maskable) {
      throw new ModelApiRefusal(
        400,
        'MODEL_API_GUARDRAIL_BLOCKED',
        `The organization's guardrails would rewrite a name in the request's ${segment.where}, which cannot be masked without breaking the request; nothing was sent to the model.`,
      );
    }
    segment.write(masked);
  }
}

/**
 * Build the request's guardrails from the organization's policy files. The
 * events every non-pass verdict records (the Security page's guardrail log)
 * name the request as `model-api:<requestId>` — the server's own id, the
 * request's op row — with the id the caller was answered with
 * (`callerRequestId`, which a caller may have chosen) kept beside it, and
 * the `__direct_api__` lane.
 */
export async function buildModelApiGuardrails(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    requestId: string;
    callerRequestId: string | undefined;
    /** Awaited once, before the first chain run that may call the paid
     * moderation provider — the caller's budget read. Throws to refuse. */
    beforePaidCall: () => Promise<void>;
  },
): Promise<ModelApiGuardrails> {
  let policies: TurnPolicies;
  try {
    policies = await readInputPolicies(args.orgSlug);
  } catch (error) {
    console.error(
      `[model-api] ${args.organizationId}: the guardrail policies cannot be read, so the model endpoints relay nothing until they are restored:`,
      error,
    );
    throw unavailable(
      "The organization's guardrail policies cannot be read right now, so nothing is relayed; try again shortly.",
    );
  }
  if (policies.pii?.enabled === true && policies.pii.mode === 'tokenize') {
    throw new ModelApiRefusal(
      403,
      'MODEL_API_GUARDRAIL_UNSUPPORTED',
      "The organization's PII policy tokenizes personal data and puts it back into the reply — a round trip the model endpoints cannot make, since the reply is relayed as the model sends it. Ask an admin to set the PII policy to mask or block, or use Tale's chat.",
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the governance seam is the only ctx facility the moderation round and the event write use
  const ctx = createCtxShim(
    governanceShimHandlers(sql),
  ) as unknown as ActionCtx;
  const built = buildTurnGuardrails(ctx, {
    organizationId: args.organizationId,
    threadId: `model-api:${args.requestId}`,
    agentSlug: DIRECT_API_AGENT_SLUG,
    ...(args.callerRequestId !== undefined
      ? { requestId: args.callerRequestId }
      : {}),
    policies,
  });
  const filters: readonly GuardrailFilter[] = built.inputFilters ?? [];
  if (
    policies.pii?.enabled === true &&
    !filters.some((filter) => filter.name === 'pii')
  ) {
    console.error(
      `[model-api] ${args.organizationId}: the PII policy is on but cannot be built; the model endpoints relay nothing until it is fixed`,
    );
    throw unavailable(
      "The organization's PII policy cannot be applied right now, so nothing is relayed; ask an admin to check it under Settings → Governance → Guardrails.",
    );
  }
  const options: GuardrailChainOptions = built.guardrailOptions ?? {};
  const moderated =
    policies.moderation?.enabled === true &&
    policies.moderation.appliesTo.includes('input');
  const fingerprint = `${args.organizationId}\0${policyFingerprint(policies)}`;
  const keyOf = (text: string) => sha256(`${fingerprint}\0${text}`);

  /** Run the chain over one text, piece by piece; the judged text, or the
   * refusal. */
  const judge = async (text: string, where: string): Promise<string> => {
    let judged = '';
    for (const piece of piecesForScan(text)) {
      const result = await runGuardrailChain(piece, 'input', filters, options);
      if (result.refusal !== undefined) {
        throw refusalFor(result.refusal, where);
      }
      judged += result.text;
    }
    return judged;
  };

  /** Judge one text alone and put the verdict on its segments. */
  const judgeAlone = async (entry: Pending): Promise<void> => {
    const judged = await judge(entry.text, placeOf(entry.segments));
    const masked = judged === entry.text ? undefined : judged;
    applyVerdict(entry.segments, entry.text, masked);
    rememberVerdict(entry.key, masked, Date.now());
  };

  return {
    async apply(request) {
      if (filters.length === 0) return;
      if (request.segmentOverflow) {
        throw textTooLarge(
          `The request carries more than ${MAX_TEXT_SEGMENTS.toLocaleString('en')} separate texts for the organization's guardrails to read. Shorten the conversation, or start a new one.`,
        );
      }
      if (request.textBytes > MAX_SCANNED_TEXT_BYTES) {
        throw textTooLarge(
          `The request carries ${(request.textBytes / 1024 / 1024).toFixed(1)} MB of text for the organization's guardrails to read; one request may carry at most ${MAX_SCANNED_TEXT_BYTES / 1024 / 1024} MB. Shorten the conversation, or start a new one.`,
        );
      }
      const now = Date.now();
      const pending = new Map<string, Pending>();
      for (const segment of request.segments) {
        const text = segment.read();
        if (text.trim() === '') continue;
        const key = keyOf(text);
        const queued = pending.get(key);
        if (queued !== undefined) {
          queued.segments.push(segment);
          continue;
        }
        const recalled = recalledVerdict(key, now);
        if (recalled !== undefined) {
          applyVerdict([segment], text, recalled.masked);
          continue;
        }
        pending.set(key, { key, text, segments: [segment] });
      }
      if (pending.size === 0) return;

      // Plan the runs: texts past the scan limit alone, in pieces; the rest
      // joined into units up to the limit.
      const alone: Pending[] = [];
      const units: Pending[][] = [];
      let unit: Pending[] = [];
      let unitBytes = 0;
      let runs = 0;
      for (const entry of pending.values()) {
        const bytes = Buffer.byteLength(entry.text);
        if (bytes > PIECE_BYTES) {
          alone.push(entry);
          runs += piecesForScan(entry.text).length;
          continue;
        }
        const joined =
          unitBytes + bytes + (unit.length > 0 ? UNIT_SEPARATOR_BYTES : 0);
        if (unit.length > 0 && joined > PIECE_BYTES) {
          units.push(unit);
          unit = [];
          unitBytes = 0;
        }
        unitBytes += bytes + (unit.length > 0 ? UNIT_SEPARATOR_BYTES : 0);
        unit.push(entry);
      }
      if (unit.length > 0) units.push(unit);
      runs += units.length;
      if (runs > MAX_CHAIN_RUNS) {
        throw textTooLarge(
          `The request carries more new text than the organization's guardrails read in one request (${runs} runs of the chain; at most ${MAX_CHAIN_RUNS}). Send the conversation in smaller steps.`,
        );
      }
      if (moderated) await args.beforePaidCall();

      for (const entry of alone) await judgeAlone(entry);
      for (const entries of units) {
        const only = entries.length === 1 ? entries[0] : undefined;
        if (only !== undefined) {
          await judgeAlone(only);
          continue;
        }
        const joined = entries.map((entry) => entry.text).join(UNIT_SEPARATOR);
        const judged = await judge(
          joined,
          placeOf(entries.flatMap((entry) => entry.segments)),
        );
        if (judged === joined) {
          const at = Date.now();
          for (const entry of entries)
            rememberVerdict(entry.key, undefined, at);
          continue;
        }
        const parts = judged.split(UNIT_SEPARATOR);
        if (parts.length !== entries.length) {
          // A mask reached across the separator: judge each text alone.
          for (const entry of entries) await judgeAlone(entry);
          continue;
        }
        const at = Date.now();
        entries.forEach((entry, index) => {
          const part = parts[index] ?? entry.text;
          const masked = part === entry.text ? undefined : part;
          applyVerdict(entry.segments, entry.text, masked);
          rememberVerdict(entry.key, masked, at);
        });
      }
    },
  };
}
