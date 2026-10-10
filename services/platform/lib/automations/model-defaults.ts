/**
 * Model defaults for documents an organization did not write itself — the
 * shipped packs it is given, the templates it starts from: when its providers
 * do not serve the model a step names, the step gets one they do serve,
 * picked the way the chat's Auto picks, instead of failing on its first live
 * run.
 *
 * Only an `llm` step's literal model is ever replaced. A templated model is
 * the author's decision at run time; an `agent` step runs on a harness whose
 * own lanes decide what serves it. The replacement is the candidate's own id,
 * as its provider lists it, so the run's serving walk finds it as listed.
 *
 * Pure: the host says, per declared model, which replacement to use (or
 * none), and supplies the candidates the pick chooses from.
 */

import { modelIdsEquivalent } from '@tale/shared/utils/model-ref';

import { MODEL_BANDS, type ModelBand } from '../chat/model-band';
import {
  chooseChatModel,
  eligibleChatCandidates,
  PREFERRED_CHAT_MODELS,
  type ChatChoiceEntry,
} from '../chat/model-choice';

/** The band a known model belongs to — its place in the chat Auto's curated
 * lists — or undefined for a model they do not name. */
export function modelBandOf(modelId: string): ModelBand | undefined {
  return MODEL_BANDS.find((band) =>
    PREFERRED_CHAT_MODELS[band].some((known) =>
      modelIdsEquivalent(known, modelId),
    ),
  );
}

/** An `llm` step that names a model literally. */
export interface LlmModelStep {
  index: number;
  nodeId: string;
  model: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `llm` steps of a document that name a model literally, in order. */
export function llmModelSteps(document: unknown): LlmModelStep[] {
  if (!isRecord(document) || !Array.isArray(document.nodes)) return [];
  const steps: LlmModelStep[] = [];
  for (const [index, node] of document.nodes.entries()) {
    if (!isRecord(node) || node.type !== 'llm') continue;
    const model = typeof node.model === 'string' ? node.model.trim() : '';
    if (model === '' || model.includes('{{')) continue;
    steps.push({
      index,
      nodeId: typeof node.id === 'string' ? node.id : String(index),
      model,
    });
  }
  return steps;
}

/**
 * The model a step should use instead of `declared`, chosen from the
 * candidates the organization serves for its band — the band given, else the
 * declared model's own, else `standard` — or null when none can be picked.
 */
export function pickReplacementModel<T extends ChatChoiceEntry>(
  declared: string,
  candidates: readonly T[],
  band?: ModelBand,
): T | null {
  const screened = eligibleChatCandidates(candidates, {
    requiresVision: false,
  });
  if ('refusal' in screened) return null;
  const choice = chooseChatModel(
    screened.pool,
    band ?? modelBandOf(declared) ?? 'standard',
  );
  return choice?.entry ?? null;
}

/** One step whose model was replaced. */
export interface ModelDefaultsChange {
  nodeId: string;
  from: string;
  to: string;
}

/**
 * A copy of `document` whose literal `llm` models are replaced where
 * `replacementFor` names a model to use instead, and the steps it changed.
 * The document itself is never mutated.
 */
export function applyModelDefaults<
  N extends object,
  D extends { nodes: readonly N[] },
>(
  document: D,
  replacementFor: (model: string) => string | null,
): { document: D; changes: ModelDefaultsChange[] } {
  const changes: ModelDefaultsChange[] = [];
  const replaced = new Map<number, string>();
  for (const step of llmModelSteps(document)) {
    const to = replacementFor(step.model);
    if (to === null || to === step.model) continue;
    replaced.set(step.index, to);
    changes.push({ nodeId: step.nodeId, from: step.model, to });
  }
  if (changes.length === 0) return { document, changes };
  const nodes = document.nodes.map((node, index) => {
    const to = replaced.get(index);
    return to === undefined ? node : { ...node, model: to };
  });
  return { document: { ...document, nodes }, changes };
}

/** The version message's account of the replacements: one sentence per
 * model replaced, whichever steps named it. */
export function modelDefaultsMessage(
  changes: readonly ModelDefaultsChange[],
): string {
  const pairs = new Map<string, string>();
  for (const change of changes) {
    if (!pairs.has(change.from)) pairs.set(change.from, change.to);
  }
  return [...pairs]
    .map(([from, to]) => `Model ${from} isn't served here; using ${to}.`)
    .join(' ');
}
