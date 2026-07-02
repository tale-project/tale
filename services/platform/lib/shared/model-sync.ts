/**
 * Pure model-catalog sync engine — shared by the weekly GitHub Action (which
 * updates the shipped `builtin-configs/providers/*.json` and opens a PR) and
 * the in-instance Convex cron (which keeps each org's provider config fresh).
 *
 * Given a provider's CURRENT models, the BASE shipped defaults, and fresh FACTS
 * fetched from OpenRouter, it produces an updated model list plus a change log.
 * Three operations, all conservative:
 *
 *   1. UPDATE — refresh capability fields (cost, context, reasoning, caching…)
 *      from facts, but ONLY where the current value still equals the shipped
 *      default. Anything an operator edited is left untouched (3-way merge).
 *   2. ADD    — append newly-released flagship models from a curated set of
 *      frontier vendors that aren't already present (and weren't previously
 *      removed by the operator).
 *   3. HIDE   — mark a strictly-older same-family model `hidden` when a newer
 *      version is added, again only when the operator hasn't set `hidden` by
 *      hand. Hidden models stay resolvable, so existing agents/workflows that
 *      reference them keep working — they just drop out of the pickers.
 *
 * No IO, no Convex/Node imports — unit-testable and importable from both a
 * plain bun script and a Convex action.
 */

import type {
  ModelDefinition,
  PromptCachingCapabilityConfig,
  ReasoningCapabilityConfig,
} from './schemas/providers';

/** Fresh per-model facts from a catalog (the subset of `NormalizedCapability`
 *  this engine consumes). */
export interface ModelFacts {
  modelId: string;
  displayName?: string;
  isChat?: boolean;
  reasoning?: ReasoningCapabilityConfig;
  promptCaching?: PromptCachingCapabilityConfig;
  inputCentsPerMillion?: number;
  outputCentsPerMillion?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
}

/**
 * Curated frontier vendors (the `vendor` prefix before `/` in a model id).
 * Only models under these prefixes are auto-added; everything else is left to
 * operators. Open- and closed-weight both included. Kept in sync with the
 * vendors curated in `builtin-configs/providers/openrouter.json` so the weekly
 * sync version-bumps every shipped preset family.
 */
const FRONTIER_VENDORS: readonly string[] = [
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'moonshotai',
  'minimax',
  'qwen',
  'x-ai',
  'mistralai',
  'z-ai',
  'meta-llama',
  'nvidia',
  'xiaomi',
  'cohere',
  'microsoft',
  'amazon',
  'perplexity',
  'ai21',
  'rekaai',
  'liquid',
];

/**
 * Substrings that mark a catalog entry as NOT a general flagship chat model:
 * non-chat heads, safety/aux models, free/preview/dated snapshots. Conservative
 * — keeps auto-add noise low; operators can still add anything by hand.
 */
const NON_FLAGSHIP_MARKERS: readonly string[] = [
  'embed',
  'whisper',
  'tts',
  'image',
  'vision-ocr',
  'guard',
  'moderation',
  'rerank',
  'audio',
  ':free',
  ':beta',
  ':extended',
  ':online',
];

/** Vendor prefix before the first `/`, lowercased. `''` when unqualified. */
function vendorOf(modelId: string): string {
  const slash = modelId.indexOf('/');
  return slash === -1 ? '' : modelId.slice(0, slash).toLowerCase();
}

function isFrontierVendor(modelId: string): boolean {
  return FRONTIER_VENDORS.includes(vendorOf(modelId));
}

/** A dated snapshot suffix like `-20250114` or `-2512` — non-flagship noise. */
const DATED_SNAPSHOT = /-\d{4,8}$/;

/**
 * Whether a fact looks like a flagship chat model worth auto-adding: a frontier
 * vendor, a text-output (chat) model, and free of the non-flagship markers.
 */
export function isFlagshipChatModel(fact: ModelFacts): boolean {
  if (!isFrontierVendor(fact.modelId)) return false;
  // Only add models we know emit text. A catalog that doesn't report modality
  // (isChat === undefined) is treated as not-known-chat to stay safe.
  if (fact.isChat !== true) return false;
  const id = fact.modelId.toLowerCase();
  if (NON_FLAGSHIP_MARKERS.some((marker) => id.includes(marker))) return false;
  if (DATED_SNAPSHOT.test(id)) return false;
  return true;
}

interface ParsedModel {
  vendor: string;
  /** Family stem with version tokens removed, e.g. `claude-opus` / `gpt`. */
  familyKey: string;
  /** Numeric version tuple parsed from the id, e.g. `[4, 6]`. */
  version: number[];
}

/**
 * Split a model id into vendor + family stem + numeric version. The version is
 * every `\d+(\.\d+)*` run concatenated; the family key is the remaining tokens
 * with those runs stripped, so `anthropic/claude-opus-4.6` and
 * `anthropic/claude-opus-4.7` share family `claude-opus` and compare [4,6] vs
 * [4,7]. Best-effort: ids with no digits get an empty version (never supersede).
 */
export function parseModelId(modelId: string): ParsedModel {
  const vendor = vendorOf(modelId);
  const slash = modelId.indexOf('/');
  const rest = (
    slash === -1 ? modelId : modelId.slice(slash + 1)
  ).toLowerCase();
  const version: number[] = [];
  for (const run of rest.matchAll(/\d+(?:\.\d+)*/g)) {
    for (const part of run[0].split('.')) version.push(Number(part));
  }
  const familyKey = rest
    .replace(/\d+(?:\.\d+)*/g, '')
    .replace(/[-_.]+/g, '-')
    .replace(/^-|-$/g, '');
  return { vendor, familyKey, version };
}

/** Lexicographic compare of numeric version tuples (shorter = lower). */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Narrows to a string-keyed map for structural traversal. Arrays pass (they
 *  index by numeric string keys), matching the prior cast-based behavior. */
function isTraversable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Stable structural equality for the small capability values we 3-way merge. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isTraversable(a) || !isTraversable(b)) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  return ak.every((k, i) => bk[i] === k && deepEqual(a[k], b[k]));
}

export interface ModelSyncChange {
  kind: 'updated' | 'added' | 'hidden';
  modelId: string;
  /** For `updated`: which fields changed. */
  fields?: string[];
}

interface SyncResult {
  models: ModelDefinition[];
  changes: ModelSyncChange[];
}

/**
 * The vendor-native id behind a gateway-shaped model id, for vendors whose
 * native naming is mechanically derivable. Anthropic: strip the vendor prefix
 * and turn version dots into dashes (`anthropic/claude-opus-4.8` →
 * `claude-opus-4-8`). Consumed by BYO (direct-to-vendor) sessions, which
 * cannot use gateway ids. Rolling `~vendor/…` aliases have no mechanical
 * native equivalent — theirs is hand-set in the shipped defaults. Returns
 * undefined for every other vendor, leaving the field to human curation.
 */
export function deriveNativeModelId(modelId: string): string | undefined {
  const prefix = 'anthropic/';
  if (!modelId.startsWith(prefix)) return undefined;
  return modelId.slice(prefix.length).replace(/\./g, '-');
}

/** Build a brand-new model definition from catalog facts. Tier/qualityScore are
 *  left unset on purpose — those are human/operator judgment, not catalog facts. */
function buildModelFromFacts(fact: ModelFacts): ModelDefinition {
  const tags: ModelDefinition['tags'] = fact.supportsVision
    ? ['chat', 'vision']
    : ['chat'];
  const nativeModelId = deriveNativeModelId(fact.modelId);
  const cost =
    fact.inputCentsPerMillion != null || fact.outputCentsPerMillion != null
      ? {
          ...(fact.inputCentsPerMillion != null
            ? { inputCentsPerMillion: fact.inputCentsPerMillion }
            : {}),
          ...(fact.outputCentsPerMillion != null
            ? { outputCentsPerMillion: fact.outputCentsPerMillion }
            : {}),
        }
      : undefined;
  return {
    id: fact.modelId,
    ...(nativeModelId !== undefined ? { nativeModelId } : {}),
    displayName: fact.displayName ?? fact.modelId,
    tags,
    ...(fact.reasoning ? { reasoning: fact.reasoning } : {}),
    ...(fact.promptCaching ? { promptCaching: fact.promptCaching } : {}),
    ...(fact.contextWindow != null
      ? { contextWindow: fact.contextWindow }
      : {}),
    ...(fact.maxOutputTokens != null
      ? { maxOutputTokens: fact.maxOutputTokens }
      : {}),
    ...(cost ? { cost } : {}),
  };
}

/**
 * Refresh one model's capability fields from facts under the 3-way rule.
 * `base` is the shipped default for this model (or `undefined` when the model
 * isn't in the shipped defaults — i.e. operator-added). Returns the next model
 * and the list of changed field names.
 */
function refreshModel(
  current: ModelDefinition,
  base: ModelDefinition | undefined,
  fact: ModelFacts,
): { next: ModelDefinition; changed: string[] } {
  const next: ModelDefinition = { ...current };
  const changed: string[] = [];

  // Apply one fresh fact under the 3-way rule. Generic + per-field `set` keeps
  // it fully type-safe (no dynamic key indexing). `set` is only invoked with a
  // non-null `factVal`, so each setter receives a defined value.
  function apply<T>(
    field: string,
    currentVal: T | undefined,
    baseVal: T | undefined,
    factVal: T | undefined,
    set: (value: T) => void,
  ): void {
    if (factVal == null || deepEqual(currentVal, factVal)) return;
    // Operator-added model (no base): only FILL when unset, never overwrite.
    if (!base) {
      if (currentVal == null) {
        set(factVal);
        changed.push(field);
      }
      return;
    }
    // In base: update only when the operator hasn't diverged from the default.
    if (deepEqual(currentVal, baseVal)) {
      set(factVal);
      changed.push(field);
    }
  }

  apply(
    'contextWindow',
    current.contextWindow,
    base?.contextWindow,
    fact.contextWindow,
    (v) => {
      next.contextWindow = v;
    },
  );
  apply(
    'maxOutputTokens',
    current.maxOutputTokens,
    base?.maxOutputTokens,
    fact.maxOutputTokens,
    (v) => {
      next.maxOutputTokens = v;
    },
  );
  apply(
    'reasoning',
    current.reasoning,
    base?.reasoning,
    fact.reasoning,
    (v) => {
      next.reasoning = v;
    },
  );
  apply(
    'promptCaching',
    current.promptCaching,
    base?.promptCaching,
    fact.promptCaching,
    (v) => {
      next.promptCaching = v;
    },
  );
  // Cost is nested; merge the two token-price sub-fields independently.
  apply(
    'cost.inputCentsPerMillion',
    current.cost?.inputCentsPerMillion,
    base?.cost?.inputCentsPerMillion,
    fact.inputCentsPerMillion,
    (v) => {
      next.cost = { ...next.cost, inputCentsPerMillion: v };
    },
  );
  apply(
    'cost.outputCentsPerMillion',
    current.cost?.outputCentsPerMillion,
    base?.cost?.outputCentsPerMillion,
    fact.outputCentsPerMillion,
    (v) => {
      next.cost = { ...next.cost, outputCentsPerMillion: v };
    },
  );

  return { next, changed };
}

/**
 * Sync one provider's model list. See the file header for the three operations.
 * `base` defaults to `current` (the repo-defaults / GitHub-Action case, where
 * every field is a default and so always refreshable). For the in-instance cron,
 * pass the shipped builtin config as `base` to preserve operator edits.
 */
export function syncProviderModels(input: {
  current: ModelDefinition[];
  facts: ModelFacts[];
  base?: ModelDefinition[];
}): SyncResult {
  const { current, facts } = input;
  const base = input.base ?? current;
  const baseById = new Map(base.map((m) => [m.id, m]));
  const currentIds = new Set(current.map((m) => m.id));
  const factsById = new Map(facts.map((f) => [f.modelId, f]));
  const changes: ModelSyncChange[] = [];

  // 1. UPDATE existing models from facts (3-way).
  let models = current.map((m) => {
    const fact = factsById.get(m.id);
    if (!fact) return m;
    const { next, changed } = refreshModel(m, baseById.get(m.id), fact);
    if (changed.length > 0) {
      changes.push({ kind: 'updated', modelId: m.id, fields: changed });
    }
    return next;
  });

  // 2. ADD newer VERSIONS of frontier families this config already curates.
  //    We deliberately do NOT add brand-new families (a vendor's new product
  //    line stays a human/curation decision) — only upgrades like
  //    claude-opus-4.6 → 4.7. This bounds additions to genuine version bumps
  //    and keeps OpenRouter facts from polluting non-gateway provider configs.
  //    Skip ids the operator already removed (in base, not current).
  const removed = new Set(
    base.filter((b) => !currentIds.has(b.id)).map((b) => b.id),
  );
  // Highest configured version per curated frontier family (`vendor::family`).
  const familyMax = new Map<string, number[]>();
  for (const m of current) {
    const p = parseModelId(m.id);
    if (!FRONTIER_VENDORS.includes(p.vendor) || p.version.length === 0)
      continue;
    const key = `${p.vendor}::${p.familyKey}`;
    const prev = familyMax.get(key);
    if (!prev || compareVersions(p.version, prev) > 0) {
      familyMax.set(key, p.version);
    }
  }
  // Pick at most ONE catalog candidate per family — the single latest version
  // that beats the configured max — so we never add-then-hide intermediate
  // versions in the same run.
  const bestByFamily = new Map<
    string,
    { fact: ModelFacts; version: number[] }
  >();
  for (const fact of facts) {
    if (currentIds.has(fact.modelId) || removed.has(fact.modelId)) continue;
    if (!isFlagshipChatModel(fact)) continue;
    const p = parseModelId(fact.modelId);
    // Reject empty or date-like versions (e.g. a `-2025-07-28` snapshot parses
    // to [2025,7,28]); real model versions are small numbers.
    if (p.version.length === 0 || p.version.some((n) => n >= 1000)) continue;
    const key = `${p.vendor}::${p.familyKey}`;
    const configuredMax = familyMax.get(key);
    // Family must already be curated here AND this must be a newer version.
    if (!configuredMax || compareVersions(p.version, configuredMax) <= 0) {
      continue;
    }
    const best = bestByFamily.get(key);
    if (!best || compareVersions(p.version, best.version) > 0) {
      bestByFamily.set(key, { fact, version: p.version });
    }
  }
  const additions: ModelDefinition[] = [...bestByFamily.values()].map((b) => {
    changes.push({ kind: 'added', modelId: b.fact.modelId });
    return buildModelFromFacts(b.fact);
  });
  models = [...models, ...additions];

  // 3. HIDE strictly-older same-family models superseded by an addition, unless
  //    the operator set `hidden` by hand (3-way on the `hidden` field).
  for (const added of additions) {
    const pa = parseModelId(added.id);
    if (pa.version.length === 0) continue; // can't reason about version → skip
    models = models.map((m) => {
      if (m.id === added.id || m.hidden) return m;
      const pm = parseModelId(m.id);
      if (pm.vendor !== pa.vendor || pm.familyKey !== pa.familyKey) return m;
      if (compareVersions(pm.version, pa.version) >= 0) return m;
      const baseM = baseById.get(m.id);
      // Strict (not `?? false`) so an explicit operator `hidden: false` is
      // distinguished from an unset default and therefore preserved.
      const operatorSetHidden = baseM
        ? m.hidden !== baseM.hidden
        : m.hidden !== undefined;
      if (operatorSetHidden) return m;
      changes.push({ kind: 'hidden', modelId: m.id });
      return { ...m, hidden: true };
    });
  }

  return { models, changes };
}
