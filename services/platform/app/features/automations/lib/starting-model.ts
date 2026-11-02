/**
 * The model the Blank wizard starts on. An automation's agent names its
 * model and has no Auto, so the wizard takes the chat's start and makes it
 * concrete: the user's saved chat pick when the wizard offers it, matched the
 * way the chat matches it; else the model the chat's Auto picks for everyday
 * work, the `standard` band the standard agent and the template defaults pick
 * in too; else the first model on offer.
 */

import { findPickedModel } from '@/app/features/chat/components/composer-model-picker';
import type { ChatModelPick } from '@/app/features/chat/types';
import {
  chooseChatModel,
  eligibleChatCandidates,
  type ChatChoiceEntry,
} from '@/lib/chat/model-choice';
import type { ComposerModelListingRow } from '@/lib/shared/harness-offer';

/** A listing row with the catalog facts the chat's Auto screen reads. */
export interface StartingModelRow extends ComposerModelListingRow {
  readonly tags?: readonly string[];
  readonly tools?: boolean;
  readonly vision?: boolean;
  readonly pricing?: {
    readonly inputCentsPerMillion: number;
    readonly outputCentsPerMillion: number;
  };
}

function servedDirectly(row: StartingModelRow): boolean {
  return (
    row.credential.authMethod === 'api-key' ||
    row.credential.authMethod === 'env'
  );
}

/** The row to start on among the rows the wizard offers, or undefined when
 * it offers none. */
export function startingModel<T extends StartingModelRow>(
  offered: readonly T[],
  savedPick: ChatModelPick | undefined,
): T | undefined {
  const saved =
    savedPick === undefined ? undefined : findPickedModel(offered, savedPick);
  if (saved !== undefined) return saved;
  // Auto routes only directly served models; a subscription's model is the
  // pick only when nothing else is offered, as for the standard agent.
  const direct = offered.filter(servedDirectly);
  const pool = direct.length > 0 ? direct : offered;
  const screened = eligibleChatCandidates(
    pool.map((row) => {
      const entry: ChatChoiceEntry & { row: T } = {
        id: row.id,
        provider: row.providerSlug,
        tags: [...(row.tags ?? [])],
        supportsTools: row.tools === true,
        supportsVision: row.vision === true,
        row,
      };
      if (row.pricing !== undefined) entry.pricing = { ...row.pricing };
      return entry;
    }),
    { requiresVision: false },
  );
  const choice =
    'refusal' in screened ? null : chooseChatModel(screened.pool, 'standard');
  return choice?.entry.row ?? pool[0];
}
