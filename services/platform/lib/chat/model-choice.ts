/**
 * Band → concrete catalog entry, for the chat Auto pick.
 *
 * `model-band.ts` reads the message; this module reads the org's eligible
 * catalog and picks the entry the band deserves. Order of authority:
 *
 *  1. **Preferred** — the first {@link PREFERRED_CHAT_MODELS} entry (target
 *     band first, then weaker bands) the org can serve. A curated known-good
 *     model beats an unknown one that merely prices lower: live catalogs say
 *     nothing about whether a model chats well, and price is not a quality
 *     signal (the newest generation is routinely cheaper than the one it
 *     replaced). Matched with {@link modelIdsEquivalent}, so one entry covers
 *     every connector's spelling of the same model.
 *  2. **Cheapest** — lowest output price among the eligible pool, unpriced
 *     entries last, deterministic (price, provider, id) tie-break. The
 *     universal fallback for catalogs the curated head doesn't know.
 *
 *  (0. **Pinned** — the `default_models` governance rule — is resolved by the
 *     Convex caller before either: an admin naming a model is the escape
 *     hatch from auto-selection entirely.)
 *
 * Eligibility carries the hazard list the vision auto-pick already paid for:
 * media generators and free-tier lanes both list a token price of ~0 and
 * would otherwise always win a price sort, and both refuse or throttle real
 * chat calls. Tool support is a SOFT filter — the chat assistant ships tools,
 * so tool-capable models are preferred, but an all-`supportsTools: false`
 * catalog (every plain OpenAI-compatible `/models` listing: the field can't
 * be derived, so normalization writes `false` across the board) must not
 * make Auto unresolvable. Vision, by contrast, is HARD when the message
 * carries images: picking a blind model would silently drop the attachment.
 *
 * Pure by design — candidates in, choice out — so the whole policy is
 * unit-testable without a Convex world.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { modelIdsEquivalent } from '@tale/shared/utils/model-ref';

import { MODEL_BANDS, type ModelBand } from './model-band';

/**
 * Curated picks per band, best first, in vendor-bare spelling (matched via
 * {@link modelIdsEquivalent}, so `claude-haiku-4-5` also covers
 * `anthropic/claude-haiku-4-5` on a gateway connector). Editorial by design
 * and expected to age: entries the org can't serve are skipped, so a stale
 * list degrades to the price fallback, never to a broken pick.
 *
 * `gpt-5.5-pro` is deliberately absent from `frontier` — at 6× the price of
 * `gpt-5.5` it is an explicit-pin model, not an auto-pick. A successor sits
 * directly ahead of the model it replaces (`claude-fable-5-1` before
 * `claude-fable-5`, `claude-opus-5-5` before `claude-opus-4-8`), so an org
 * that has not enabled the new one keeps its previous curated pick.
 */
export const PREFERRED_CHAT_MODELS: Readonly<
  Record<ModelBand, readonly string[]>
> = {
  frontier: [
    'claude-fable-5-1',
    'claude-fable-5',
    'gpt-5.5',
    'claude-opus-5-5',
    'claude-opus-4-8',
    'gemini-3.1-pro-preview',
  ],
  standard: [
    'claude-sonnet-5',
    'gpt-5.6-luna-pro',
    'grok-4.5',
    'gemini-3.6-flash',
    'glm-5.2',
  ],
  draft: [
    'claude-haiku-4-5',
    'gemini-3.5-flash-lite',
    // DeepSeek's current Flash (V4.1): the vendor's own id, then the
    // aggregator's dated spelling of the same model.
    'deepseek-flash',
    'deepseek-v4.1-flash',
    'qwen3.6-flash',
  ],
};

/** Why an Auto turn could not resolve — the caller renders these as explicit
 * refusals, never as a silent fallback to some other model. */
export type ChatAutoRefusal = 'no-chat-model' | 'no-vision-model';

/** What the choice reads of a model — enough to screen and rank it, so a
 * listing that is not a raw catalog (the composer's servable options, as the
 * standard agent's automatic model chooses from) is chosen by the same
 * rules. */
export type ChatChoiceEntry = Pick<
  ModelCatalogEntry,
  | 'id'
  | 'provider'
  | 'tags'
  | 'supportsTools'
  | 'supportsVision'
  | 'outputsMedia'
  | 'pricing'
>;

export interface ChatModelChoice<
  T extends ChatChoiceEntry = ModelCatalogEntry,
> {
  entry: T;
  source: 'preferred' | 'cheapest';
}

/** A single entry's hazard screen — the tag says "chat", these say "and a
 * real chat call will actually be served". */
function isServableChatEntry(entry: ChatChoiceEntry): boolean {
  if (!entry.tags.includes('chat')) return false;
  // A media GENERATOR may take text in, but a chat call to it is a provider
  // 400, and its 0 token price is a per-artifact-billing artifact.
  if (entry.outputsMedia === true) return false;
  // Free-tier lanes sit behind per-account data-policy gates and hard rate
  // caps — the "cheapest" pick would turn into a 401/429 storm.
  if (entry.id.endsWith(':free')) return false;
  if (
    entry.pricing !== undefined &&
    entry.pricing.inputCentsPerMillion === 0 &&
    entry.pricing.outputCentsPerMillion === 0
  ) {
    return false;
  }
  return true;
}

/**
 * The eligible pool for one Auto pick, or the refusal that explains why
 * there is none. `entries` must already be credential- and
 * governance-filtered — this screen is about the models themselves.
 */
export function eligibleChatCandidates<T extends ChatChoiceEntry>(
  entries: readonly T[],
  opts: { requiresVision: boolean },
): { pool: readonly T[] } | { refusal: ChatAutoRefusal } {
  const servable = entries.filter(isServableChatEntry);
  if (servable.length === 0) return { refusal: 'no-chat-model' };

  // Soft: prefer tool-capable, but never empty the pool over a catalog that
  // simply couldn't declare the field (see the header).
  const withTools = servable.filter((entry) => entry.supportsTools);
  const pool = withTools.length > 0 ? withTools : servable;

  if (!opts.requiresVision) return { pool };
  const withVision = pool.filter((entry) => entry.supportsVision);
  if (withVision.length === 0) return { refusal: 'no-vision-model' };
  return { pool: withVision };
}

/** Bands to try for a target: the target itself, then weaker ones. Never
 * stronger — a trivial message must not escalate to a frontier model just
 * because the curated draft picks are absent (the price fallback handles
 * that org shape at the right cost). */
function bandsToTry(target: ModelBand): readonly ModelBand[] {
  const rank = MODEL_BANDS.indexOf(target);
  return MODEL_BANDS.slice(0, rank + 1).toReversed();
}

/**
 * Pick one entry from a non-empty eligible pool. Total for such pools: the
 * price fallback always yields an entry, so `null` only ever means "empty
 * pool" (which {@link eligibleChatCandidates} already refuses earlier).
 */
export function chooseChatModel<T extends ChatChoiceEntry>(
  pool: readonly T[],
  band: ModelBand,
): ChatModelChoice<T> | null {
  for (const tryBand of bandsToTry(band)) {
    for (const preferred of PREFERRED_CHAT_MODELS[tryBand]) {
      const entry = pool.find((candidate) =>
        modelIdsEquivalent(preferred, candidate.id),
      );
      if (entry !== undefined) return { entry, source: 'preferred' };
    }
  }

  let cheapest: { entry: T; price: number } | null = null;
  for (const entry of pool) {
    const price =
      entry.pricing?.outputCentsPerMillion ?? Number.POSITIVE_INFINITY;
    if (
      cheapest === null ||
      price < cheapest.price ||
      (price === cheapest.price &&
        (entry.provider < cheapest.entry.provider ||
          (entry.provider === cheapest.entry.provider &&
            entry.id < cheapest.entry.id)))
    ) {
      cheapest = { entry, price };
    }
  }
  return cheapest === null
    ? null
    : { entry: cheapest.entry, source: 'cheapest' };
}
