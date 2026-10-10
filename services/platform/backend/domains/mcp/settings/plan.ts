/**
 * A plan of settings changes: for each, what it would do to what is stored
 * now — create, update, delete, act, or nothing — member by member, with
 * the effects and the risk a person should weigh, or why it is refused.
 * Planning reads and never writes, so a client can show the plan to the
 * person before anything changes; applying plans again against fresh
 * reads before its first write.
 */

import {
  SETTINGS_EFFECTS,
  settingsKindDescriptor,
  type SettingsEffect,
  type SettingsKind,
  type SettingsRisk,
} from '@tale/shared/schemas/settings-kinds';

import { isRecord } from '../../../../lib/utils/type-utils.ts';
import { type McpRefusal, refusalFromThrown } from '../refusals.ts';
import { diffConfigs, type SettingsDiffEntry } from './diff.ts';
import {
  type HandlerPlan,
  type SettingsChange,
  type SettingsContext,
  type SettingsKindHandler,
  type SettingsOperation,
  type SettingsRegistry,
  type SettingsResource,
  settingsKey,
} from './registry.ts';
import {
  maskSecrets,
  restoreMaskedSecrets,
  secretArgumentRefusal,
} from './secrets.ts';

/** What applying a change does: `unchanged` writes nothing. */
export type SettingsAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'act'
  | 'unchanged';

/** One change as a plan answers it. */
export interface PlannedChange {
  readonly kind: SettingsKind;
  /** The resource's id within its kind (null for a single resource, or
   * when the change named none). */
  readonly id: string | null;
  /** The resource's address — `expected` names it by this key. */
  readonly key: string;
  readonly op: SettingsOperation;
  readonly act?: string;
  /** Absent when the change is refused. */
  readonly action?: SettingsAction;
  /** The hash stored now (null: no such resource) — what applying the
   * change must name as expected. Absent when it could not be read. */
  readonly currentHash?: string | null;
  readonly diff: readonly SettingsDiffEntry[];
  readonly diffTruncated?: true;
  readonly effects: readonly SettingsEffect[];
  readonly risk: SettingsRisk;
  readonly refusal?: McpRefusal;
}

/** A planned change with what applying it needs. */
export interface PreparedChange {
  readonly planned: PlannedChange;
  /** Its place in the call. */
  readonly index: number;
  /** Where its kind applies among the call's changes. */
  readonly order: number;
  /** Present when the change is not refused. */
  readonly ready?: {
    readonly handler: SettingsKindHandler;
    /** The change as its writer receives it: masked values put back. */
    readonly change: SettingsChange;
  };
}

const RISK_RANK: Readonly<Record<SettingsRisk, number>> = {
  low: 0,
  high: 1,
  critical: 2,
};

/** The highest of a kind's base risk and its effects'. */
function riskOf(
  base: SettingsRisk,
  effects: readonly SettingsEffect[],
): SettingsRisk {
  let risk = base;
  for (const effect of effects) {
    const next = SETTINGS_EFFECTS[effect];
    if (RISK_RANK[next] > RISK_RANK[risk]) risk = next;
  }
  return risk;
}

/** The refusal of a kind this deployment does not serve. */
export function unavailable(kind: SettingsKind): McpRefusal {
  return {
    error: `settings of kind "${kind}" are not served over MCP on this deployment`,
    code: 'SETTINGS_KIND_UNAVAILABLE',
    hint: 'get_settings without kinds lists the kinds and whether each is available; change this one in Tale',
  };
}

/** The refusal of an act on a resource that does not exist. */
function notFound(key: string): McpRefusal {
  return {
    error: `no ${key} to act on`,
    code: 'SETTINGS_NOT_FOUND',
    hint: 'get_settings lists what exists',
  };
}

/** The refusal of a second change to a resource the call already changes. */
function duplicate(key: string): McpRefusal {
  return {
    error: `${key} is changed twice in one call`,
    code: 'SETTINGS_DUPLICATE',
    hint: 'send one change per resource: its whole config, as it should end',
  };
}

/** The same change, refused: what it names and what is stored stay, what
 * it would have done goes. */
function refusedPlan(
  planned: PlannedChange,
  refusal: McpRefusal,
): PlannedChange {
  const { kind, id, key, op, act, currentHash } = planned;
  return {
    kind,
    id,
    key,
    op,
    ...(act === undefined ? {} : { act }),
    ...(currentHash === undefined ? {} : { currentHash }),
    diff: [],
    effects: [],
    risk: settingsKindDescriptor(kind).baseRisk,
    refusal,
  };
}

/** A refusal read from what a handler threw; anything that is not one is a
 * fault and propagates. */
function refusalOrThrow(error: unknown): McpRefusal {
  const refusal = refusalFromThrown(error);
  if (refusal === null) throw error;
  return refusal;
}

interface Outcome {
  readonly planned: PlannedChange;
  readonly ready?: PreparedChange['ready'];
}

/** Which resource a change names, before anything is read: its kind's
 * handler, its id and its key — or why it names none this deployment
 * serves. */
export interface ChangeAddress {
  readonly handler?: SettingsKindHandler;
  readonly id: string | null;
  readonly key: string;
  readonly refusal?: McpRefusal;
}

export function addressOf(
  registry: SettingsRegistry,
  change: SettingsChange,
): ChangeAddress {
  const named = change.id ?? null;
  const handler = registry[change.kind];
  if (handler === undefined) {
    return {
      id: named,
      key: settingsKey(change.kind, named),
      refusal: unavailable(change.kind),
    };
  }
  try {
    const id = handler.identify(change);
    return { handler, id, key: settingsKey(change.kind, id) };
  } catch (error) {
    return {
      handler,
      id: named,
      key: settingsKey(change.kind, named),
      refusal: refusalOrThrow(error),
    };
  }
}

/** Plan one change against a fresh read of what it changes. */
async function planOne(
  ctx: SettingsContext,
  registry: SettingsRegistry,
  change: SettingsChange,
): Promise<Outcome> {
  const descriptor = settingsKindDescriptor(change.kind);
  const head = {
    kind: change.kind,
    op: change.op,
    ...(change.act === undefined ? {} : { act: change.act }),
  };
  const refused = (
    id: string | null,
    refusal: McpRefusal,
    currentHash?: string | null,
  ): Outcome => ({
    planned: {
      ...head,
      id,
      key: settingsKey(change.kind, id),
      ...(currentHash === undefined ? {} : { currentHash }),
      diff: [],
      effects: [],
      risk: descriptor.baseRisk,
      refusal,
    },
  });
  const { handler, id, key, refusal } = addressOf(registry, change);
  if (handler === undefined || refusal !== undefined) {
    return refused(id, refusal ?? unavailable(change.kind));
  }
  const secret = secretArgumentRefusal(change, descriptor.secretPaths);
  if (secret !== null) return refused(id, secret);
  let current: SettingsResource | null;
  try {
    current = await handler.read(ctx, id);
  } catch (error) {
    return refused(id, refusalOrThrow(error));
  }
  const currentHash = current?.hash ?? null;
  if (change.op === 'act' && current === null) {
    return refused(id, notFound(key), currentHash);
  }
  let prepared = change;
  if (change.op === 'set') {
    const restored = restoreMaskedSecrets(
      change.config,
      current?.config ?? null,
      descriptor.secretPaths,
    );
    if ('refusal' in restored) {
      return refused(id, restored.refusal, currentHash);
    }
    prepared = { ...change, config: restored.config };
  }
  let plan: HandlerPlan;
  try {
    plan = await handler.plan(ctx, prepared, current);
  } catch (error) {
    return refused(id, refusalOrThrow(error), currentHash);
  }
  const action: SettingsAction =
    change.op === 'act'
      ? 'act'
      : change.op === 'delete'
        ? current === null
          ? 'unchanged'
          : 'delete'
        : current === null
          ? 'create'
          : plan.unchanged === true
            ? 'unchanged'
            : 'update';
  const effects =
    action === 'unchanged' ? [] : [...new Set(plan.effects ?? [])];
  const before =
    current === null
      ? null
      : maskSecrets(current.config, descriptor.secretPaths);
  const after =
    action === 'delete'
      ? null
      : maskSecrets(
          plan.after === undefined
            ? change.op === 'set'
              ? prepared.config
              : before
            : plan.after,
          descriptor.secretPaths,
        );
  // A created resource reads member by member; a removed one, whole.
  const { diff, truncated } =
    action === 'unchanged'
      ? { diff: [], truncated: false }
      : diffConfigs(
          action === 'create' && isRecord(after) ? {} : before,
          after,
        );
  return {
    planned: {
      ...head,
      id,
      key,
      action,
      currentHash,
      diff,
      ...(truncated ? { diffTruncated: true as const } : {}),
      effects,
      risk:
        action === 'unchanged' ? 'low' : riskOf(descriptor.baseRisk, effects),
    },
    ready: { handler, change: prepared },
  };
}

/**
 * Every change planned against what is stored now, in the call's order. A
 * resource the call changes twice is refused the second time: one change
 * per resource, its whole config as it should end.
 */
export async function prepareChanges(
  ctx: SettingsContext,
  registry: SettingsRegistry,
  changes: readonly SettingsChange[],
): Promise<PreparedChange[]> {
  const prepared: PreparedChange[] = [];
  const seen = new Set<string>();
  for (const [index, change] of changes.entries()) {
    const outcome = await planOne(ctx, registry, change);
    const { key } = outcome.planned;
    const twice = seen.has(key);
    seen.add(key);
    prepared.push({
      index,
      order: settingsKindDescriptor(change.kind).order,
      ...(twice
        ? { planned: refusedPlan(outcome.planned, duplicate(key)) }
        : outcome),
    });
  }
  return prepared;
}

/** What `plan_settings` answers: every change planned, and whether all of
 * them could be applied as planned. */
export async function planSettings(
  ctx: SettingsContext,
  registry: SettingsRegistry,
  changes: readonly SettingsChange[],
): Promise<{ ok: boolean; changes: PlannedChange[] }> {
  const prepared = await prepareChanges(ctx, registry, changes);
  const planned = prepared.map((entry) => entry.planned);
  return {
    ok: planned.every((entry) => entry.refusal === undefined),
    changes: planned,
  };
}
