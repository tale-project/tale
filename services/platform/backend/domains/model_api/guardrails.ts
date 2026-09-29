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
  readTurnPolicies,
  type TurnPolicies,
} from '../../core/chat/guardrails.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { governanceShimHandlers } from '../governance/shim.ts';
import { ModelApiRefusal, type TextSegment } from './wire.ts';

/**
 * The organization's INPUT guardrails on a model-endpoint request — the
 * chain a chat turn runs on what a person sends (`chat_filter` → PII →
 * moderation provider, built from the same policy files by the same code,
 * `core/chat/guardrails.ts`), applied to the request's system and user text
 * before it is relayed:
 *
 *  - a BLOCK refuses the request (400 `MODEL_API_GUARDRAIL_BLOCKED`, the chat
 *    turn's own sentence), and a step that FAILS under a fail-closed policy
 *    refuses it too (503 `MODEL_API_GUARDRAIL_UNAVAILABLE`);
 *  - a MASK rewrites the text in the relayed body, so the model sees what a
 *    chat turn's model would;
 *  - a PII policy in TOKENIZE mode is refused outright (403
 *    `MODEL_API_GUARDRAIL_UNSUPPORTED`): it swaps personal data for tokens
 *    and puts it back into the reply, a round trip a relayed reply never
 *    makes — relaying the tokens, or the data unmasked, would each be a
 *    silent departure from the organization's policy.
 *
 * The OUTPUT is not filtered: the model's answer, streamed or not, reaches
 * the caller as the model sent it. Assistant turns, tool results, images and
 * documents in the request are relayed unread (see the wire readers).
 *
 * A stateless wire resends the whole conversation on every request, so the
 * same system prompt and earlier messages come back again and again. A
 * verdict is remembered per organization, per policy version and per exact
 * text for a few minutes: the chain — and the moderation provider's round
 * trip — runs once per text, and a detection is recorded once rather than on
 * every resend. A block or a failure is never remembered.
 *
 * Each text is judged in pieces of at most the chain's own scan limit
 * (`MAX_MESSAGE_BYTES`), cut at line breaks: the filters stop reading past
 * that limit and a mask rebuilds only what they read, so a longer text would
 * otherwise be relayed cut short.
 */

/** How long a text's verdict is reused. */
const VERDICT_TTL_MS = 10 * 60_000;
/** How many verdicts the process keeps, oldest dropped first. */
const VERDICT_CACHE_LIMIT = 5_000;

interface Verdict {
  at: number;
  /** The text as the chain left it — the original when nothing masked. */
  text: string;
}

const verdicts = new Map<string, Verdict>();

/** Test seam: forget every remembered verdict. */
export function resetGuardrailVerdictsForTests(): void {
  verdicts.clear();
}

function rememberVerdict(key: string, text: string, now: number): void {
  verdicts.delete(key);
  verdicts.set(key, { at: now, text });
  while (verdicts.size > VERDICT_CACHE_LIMIT) {
    const oldest = verdicts.keys().next();
    if (oldest.done === true) break;
    verdicts.delete(oldest.value);
  }
}

function recalledVerdict(key: string, now: number): string | undefined {
  const verdict = verdicts.get(key);
  if (verdict === undefined) return undefined;
  if (now - verdict.at > VERDICT_TTL_MS) {
    verdicts.delete(key);
    return undefined;
  }
  return verdict.text;
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

/**
 * `text` cut into pieces of at most {@link PIECE_BYTES} UTF-8 bytes, each
 * ending at a line break where one falls inside the budget, else at the last
 * space, else at the budget itself (never inside a surrogate pair). Joined,
 * the pieces are the text.
 */
export function piecesForScan(text: string, maxBytes = PIECE_BYTES): string[] {
  if (Buffer.byteLength(text) <= maxBytes) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (Buffer.byteLength(rest) > maxBytes) {
    // The longest prefix within the budget, by code points.
    let end = 0;
    let bytes = 0;
    for (const char of rest) {
      const size = Buffer.byteLength(char);
      if (bytes + size > maxBytes) break;
      bytes += size;
      end += char.length;
    }
    const head = rest.slice(0, end);
    const lineBreak = head.lastIndexOf('\n');
    const space = head.lastIndexOf(' ');
    const cut =
      lineBreak > 0 ? lineBreak + 1 : space > 0 ? space + 1 : Math.max(end, 1);
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

export interface ModelApiGuardrails {
  /** Judge the segments in place: masks are written back; a block, a
   * fail-closed failure or an unsupported mode throws the refusal. */
  apply(segments: readonly TextSegment[]): Promise<void>;
}

function refusalFor(
  refusal: NonNullable<
    Awaited<ReturnType<typeof runGuardrailChain>>['refusal']
  >,
  role: TextSegment['role'],
): ModelApiRefusal {
  const where = role === 'system' ? 'system prompt' : 'message';
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

/**
 * Build the request's guardrails from the organization's policy files. The
 * events every non-pass verdict records (the Security page's guardrail log)
 * name the request as `model-api:<request id>` and the `__direct_api__`
 * lane.
 */
export async function buildModelApiGuardrails(
  sql: Sql,
  args: { organizationId: string; requestId: string },
): Promise<ModelApiGuardrails> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the governance seam is the only ctx facility the policy reads, the moderation round and the event write use
  const ctx = createCtxShim(
    governanceShimHandlers(sql),
  ) as unknown as ActionCtx;
  const policies = await readTurnPolicies(ctx, args.organizationId);
  if (policies.pii?.enabled === true && policies.pii.mode === 'tokenize') {
    throw new ModelApiRefusal(
      403,
      'MODEL_API_GUARDRAIL_UNSUPPORTED',
      "The organization's PII policy tokenizes personal data and puts it back into the reply — a round trip the model endpoints cannot make, since the reply is relayed as the model sends it. Ask an admin to set the PII policy to mask or block, or use Tale's chat.",
    );
  }
  const built = buildTurnGuardrails(ctx, {
    organizationId: args.organizationId,
    threadId: `model-api:${args.requestId}`,
    agentSlug: DIRECT_API_AGENT_SLUG,
    policies,
  });
  const filters: readonly GuardrailFilter[] = built.inputFilters ?? [];
  const options: GuardrailChainOptions = built.guardrailOptions ?? {};
  const fingerprint = `${args.organizationId}\0${policyFingerprint(policies)}`;

  return {
    async apply(segments) {
      if (filters.length === 0) return;
      for (const segment of segments) {
        const text = segment.read();
        if (text.trim() === '') continue;
        const now = Date.now();
        const key = `${fingerprint}\0${sha256(text)}`;
        const recalled = recalledVerdict(key, now);
        if (recalled !== undefined) {
          if (recalled !== text) segment.write(recalled);
          continue;
        }
        let judged = '';
        for (const piece of piecesForScan(text)) {
          const result = await runGuardrailChain(
            piece,
            'input',
            filters,
            options,
          );
          if (result.refusal !== undefined) {
            throw refusalFor(result.refusal, segment.role);
          }
          judged += result.text;
        }
        if (judged !== text) segment.write(judged);
        rememberVerdict(key, judged, now);
      }
    },
  };
}
