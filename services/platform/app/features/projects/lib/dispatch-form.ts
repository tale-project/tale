/**
 * The Dispatch editor's form, apart from its controls: the values it edits,
 * how a stored dispatch becomes them and they become a dispatch again, what
 * the editor checks before it saves, and where a refusal's issues belong.
 *
 * A stored dispatch keeps what it left out: a field the document did not
 * declare is written back only once someone changes it from the value
 * readers assume for it (`DISPATCH_DEFAULTS`). So a save that changes
 * nothing stores the same document, and a declaration managed configuration
 * applies keeps reading as declared. The other boards it serves and its
 * reviewers have no field here: they are written back exactly as stored.
 *
 * Numbers are edited as the text a field holds and read when the dispatch is
 * built, so an empty or half-typed field is a problem the editor names
 * rather than a value it guesses.
 */

import {
  DISPATCH_ADMISSION_PRESETS,
  DISPATCH_ASSIGNMENTS,
  DISPATCH_DEFAULTS,
  DISPATCH_GATE_WHEN_STALE,
  DISPATCH_GATES_MAX,
  DISPATCH_LABELS_MAX,
  DISPATCH_POOL_MAX,
  DISPATCH_ROLE_BRIEF_MAX,
  DISPATCH_RUNS_MAX,
  DISPATCH_STANDING_ROLES_MAX,
  dispatchRoleKeySchema,
  type DispatchAdmissionPreset,
  type DispatchAssignment,
  type DispatchGateWhenStale,
  type DispatchStatus,
  type ProjectDispatch,
  type ProjectDispatchGate,
  type ProjectDispatchRole,
} from '@tale/shared/schemas/project-dispatch';
import { z } from 'zod';

import { isValidTimezone } from '@/app/features/automations/lib/timezones';
import { parseCron } from '@/lib/automations/cron';

/** The orders ready work can be taken in: one column, or both. */
export const DISPATCH_STATUS_ORDERS = [
  'todo',
  'backlog',
  'todo,backlog',
  'backlog,todo',
] as const;
export type DispatchStatusOrder = (typeof DISPATCH_STATUS_ORDERS)[number];

/** What a standing role's mode may hold. */
export const DISPATCH_ROLE_MODE_MAX = 40;

export interface DispatchRoleFormValues {
  key: string;
  agentId: string;
  taskId: string;
  cron: string;
  timezone: string;
  mode: string;
  brief: string;
}

export interface DispatchGateFormValues {
  key: string;
  labels: string[];
  holdAt: string;
  recoverBelow: string;
  staleAfterSeconds: string;
  whenStale: DispatchGateWhenStale;
  startSpacingSeconds: string;
}

export interface DispatchFormValues {
  enabled: boolean;
  agents: string[];
  maxConcurrentRuns: string;
  perAgentConcurrency: string;
  statuses: DispatchStatusOrder;
  assignment: DispatchAssignment;
  rebalance: boolean;
  labels: { include: string[]; exclude: string[] };
  admission: {
    preset: DispatchAdmissionPreset;
    startSpacingSeconds: string;
    recheckSeconds: string;
  };
  standingRoles: DispatchRoleFormValues[];
  gates: DispatchGateFormValues[];
}

function statusOrderOf(
  statuses: readonly DispatchStatus[],
): DispatchStatusOrder {
  const joined = statuses.join(',');
  return DISPATCH_STATUS_ORDERS.find((order) => order === joined) ?? 'todo';
}

/** The columns an order takes ready work from, in that order. */
function statusesOf(order: DispatchStatusOrder): DispatchStatus[] {
  return order
    .split(',')
    .filter(
      (status): status is DispatchStatus =>
        status === 'todo' || status === 'backlog',
    );
}

/** Delays as the field shows them: `60, 120, 240`. */
function formatRecheck(seconds: readonly number[]): string {
  return seconds.join(', ');
}

/** The delays a recheck field holds, or null when it holds something that is
 * not a list of whole seconds. */
export function parseRecheck(text: string): number[] | null {
  const parts = text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const values: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    values.push(Number(part));
  }
  return values;
}

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** A new standing role's fields: blank but for the zone it reads in. */
export function emptyRole(timezone: string): DispatchRoleFormValues {
  return {
    key: '',
    agentId: '',
    taskId: '',
    cron: '',
    timezone,
    mode: '',
    brief: '',
  };
}

/** A new gate's fields: it opens when nobody reports on it, as by default. */
export function emptyGate(): DispatchGateFormValues {
  return {
    key: '',
    labels: [],
    holdAt: '',
    recoverBelow: '',
    staleAfterSeconds: '',
    whenStale: DISPATCH_DEFAULTS.gateWhenStale,
    startSpacingSeconds: '',
  };
}

/**
 * The form a dispatch is edited in: the stored one, or — for a project
 * without one — a dispatch switched on with an empty pool that may hold as
 * many runs at once as the organization has agent workers.
 */
export function toFormValues(
  dispatch: ProjectDispatch | null,
  options: { workersLimit: number },
): DispatchFormValues {
  if (dispatch === null) {
    return {
      enabled: true,
      agents: [],
      maxConcurrentRuns: String(
        Math.min(Math.max(options.workersLimit, 1), DISPATCH_RUNS_MAX),
      ),
      perAgentConcurrency: String(DISPATCH_DEFAULTS.perAgentConcurrency),
      statuses: 'todo',
      assignment: 'assigned',
      rebalance: DISPATCH_DEFAULTS.rebalance,
      labels: { include: [], exclude: [] },
      admission: {
        preset: 'default',
        startSpacingSeconds: String(DISPATCH_DEFAULTS.startSpacingSeconds),
        recheckSeconds: formatRecheck(DISPATCH_DEFAULTS.recheckSeconds),
      },
      standingRoles: [],
      gates: [],
    };
  }
  return {
    enabled: dispatch.enabled,
    agents: [...dispatch.agents],
    maxConcurrentRuns: String(dispatch.maxConcurrentRuns),
    perAgentConcurrency: String(
      dispatch.perAgentConcurrency ?? DISPATCH_DEFAULTS.perAgentConcurrency,
    ),
    statuses: statusOrderOf(dispatch.statuses),
    assignment: dispatch.assignment,
    rebalance: dispatch.rebalance ?? DISPATCH_DEFAULTS.rebalance,
    labels: {
      include: [...(dispatch.labels?.include ?? [])],
      exclude: [...(dispatch.labels?.exclude ?? [])],
    },
    admission: {
      preset: dispatch.admission?.preset ?? 'default',
      startSpacingSeconds: String(
        dispatch.admission?.startSpacingSeconds ??
          DISPATCH_DEFAULTS.startSpacingSeconds,
      ),
      recheckSeconds: formatRecheck(
        dispatch.admission?.recheckSeconds ?? DISPATCH_DEFAULTS.recheckSeconds,
      ),
    },
    standingRoles: (dispatch.standingRoles ?? []).map((role) => ({
      key: role.key,
      agentId: role.agentId,
      taskId: role.taskId,
      cron: role.cron,
      timezone: role.timezone,
      mode: role.mode ?? '',
      brief: role.brief ?? '',
    })),
    gates: (dispatch.gates ?? []).map((gate) => ({
      key: gate.key,
      labels: [...(gate.labels ?? [])],
      holdAt: numberText(gate.holdAt),
      recoverBelow: numberText(gate.recoverBelow),
      staleAfterSeconds: numberText(gate.staleAfterSeconds),
      whenStale: gate.whenStale ?? DISPATCH_DEFAULTS.gateWhenStale,
      startSpacingSeconds: numberText(gate.startSpacingSeconds),
    })),
  };
}

/** Whether an optional field is written: the stored document declared it,
 * or its value is no longer the one readers assume. */
function declares<T>(stored: T | undefined, value: T, assumed: T): boolean {
  return stored !== undefined || value !== assumed;
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function optionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

function roleOf(values: DispatchRoleFormValues): ProjectDispatchRole {
  const mode = values.mode.trim();
  const brief = values.brief.trim();
  return {
    key: values.key.trim(),
    taskId: values.taskId,
    agentId: values.agentId,
    cron: values.cron.trim(),
    timezone: values.timezone.trim(),
    ...(mode !== '' ? { mode } : {}),
    ...(brief !== '' ? { brief } : {}),
  };
}

function gateOf(
  values: DispatchGateFormValues,
  stored: ProjectDispatchGate | undefined,
): ProjectDispatchGate {
  const holdAt = optionalNumber(values.holdAt);
  const recoverBelow = optionalNumber(values.recoverBelow);
  const staleAfterSeconds = optionalNumber(values.staleAfterSeconds);
  const startSpacingSeconds = optionalNumber(values.startSpacingSeconds);
  return {
    key: values.key.trim(),
    ...(values.labels.length > 0 ? { labels: [...values.labels] } : {}),
    ...(holdAt !== undefined ? { holdAt } : {}),
    ...(recoverBelow !== undefined ? { recoverBelow } : {}),
    ...(staleAfterSeconds !== undefined ? { staleAfterSeconds } : {}),
    ...(declares(
      stored?.whenStale,
      values.whenStale,
      DISPATCH_DEFAULTS.gateWhenStale,
    )
      ? { whenStale: values.whenStale }
      : {}),
    ...(startSpacingSeconds !== undefined ? { startSpacingSeconds } : {}),
  };
}

/**
 * The dispatch a checked form saves. `stored` is the document the editor
 * started from (null for a new one): what it left out stays out unless the
 * form changed it from the value readers assume.
 */
export function toDispatch(
  values: DispatchFormValues,
  stored: ProjectDispatch | null,
): ProjectDispatch {
  const perAgentConcurrency = Number(values.perAgentConcurrency);
  const startSpacingSeconds = Number(values.admission.startSpacingSeconds);
  const recheckSeconds = parseRecheck(values.admission.recheckSeconds) ?? [
    ...DISPATCH_DEFAULTS.recheckSeconds,
  ];
  const storedAdmission = stored?.admission;
  const writesSpacing = declares(
    storedAdmission?.startSpacingSeconds,
    startSpacingSeconds,
    DISPATCH_DEFAULTS.startSpacingSeconds,
  );
  const writesRecheck =
    storedAdmission?.recheckSeconds !== undefined ||
    !sameNumbers(recheckSeconds, DISPATCH_DEFAULTS.recheckSeconds);
  const writesAdmission =
    storedAdmission !== undefined ||
    values.admission.preset !== 'default' ||
    writesSpacing ||
    writesRecheck;
  const writesInclude =
    stored?.labels?.include !== undefined || values.labels.include.length > 0;
  const writesExclude =
    stored?.labels?.exclude !== undefined || values.labels.exclude.length > 0;
  const storedGates = new Map(
    (stored?.gates ?? []).map((gate) => [gate.key, gate]),
  );
  return {
    enabled: values.enabled,
    agents: [...values.agents],
    maxConcurrentRuns: Number(values.maxConcurrentRuns),
    ...(declares(
      stored?.perAgentConcurrency,
      perAgentConcurrency,
      DISPATCH_DEFAULTS.perAgentConcurrency,
    )
      ? { perAgentConcurrency }
      : {}),
    statuses: statusesOf(values.statuses),
    assignment: values.assignment,
    ...(declares(
      stored?.rebalance,
      values.rebalance,
      DISPATCH_DEFAULTS.rebalance,
    )
      ? { rebalance: values.rebalance }
      : {}),
    ...(stored?.labels !== undefined || writesInclude || writesExclude
      ? {
          labels: {
            ...(writesInclude ? { include: [...values.labels.include] } : {}),
            ...(writesExclude ? { exclude: [...values.labels.exclude] } : {}),
          },
        }
      : {}),
    ...(writesAdmission
      ? {
          admission: {
            preset: values.admission.preset,
            ...(writesSpacing ? { startSpacingSeconds } : {}),
            ...(writesRecheck ? { recheckSeconds } : {}),
          },
        }
      : {}),
    ...(stored?.standingRoles !== undefined || values.standingRoles.length > 0
      ? { standingRoles: values.standingRoles.map(roleOf) }
      : {}),
    ...(stored?.gates !== undefined || values.gates.length > 0
      ? {
          gates: values.gates.map((gate) =>
            gateOf(gate, storedGates.get(gate.key.trim())),
          ),
        }
      : {}),
    // The boards it serves and its reviewers are declared through managed
    // configuration or the settings tools; the editor keeps them as stored.
    ...(stored?.sources !== undefined ? { sources: stored.sources } : {}),
    ...(stored?.reviewers !== undefined ? { reviewers: stored.reviewers } : {}),
  };
}

/** What a cron expression is refused for, or null when it reads. */
function cronProblem(cron: string): string | null {
  try {
    parseCron(cron.trim());
    return null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

function wholeNumberIn(text: string, min: number, max: number): boolean {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return value >= min && value <= max;
}

function blankOrWholeNumberIn(text: string, min: number, max: number): boolean {
  return text.trim() === '' || wholeNumberIn(text, min, max);
}

function blankOrNumber(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || Number.isFinite(Number(trimmed));
}

function isRecheckList(text: string): boolean {
  const values = parseRecheck(text);
  return (
    values !== null &&
    values.length >= 1 &&
    values.length <= 10 &&
    values.every((value) => value >= 10 && value <= 3_600)
  );
}

/** The sentences the editor's checks say, in the reader's language. */
export interface DispatchFormText {
  maxConcurrentRuns: string;
  perAgentConcurrency: string;
  /** One agent would hold more runs than the whole pool. */
  perAgentAboveRuns: string;
  startSpacing: string;
  recheck: string;
  agentsMax: string;
  labelsMax: string;
  key: string;
  keyTaken: string;
  roleAgent: string;
  roleTask: string;
  cronRequired: string;
  cronInvalid: (reason: string) => string;
  timezone: string;
  mode: string;
  brief: string;
  number: string;
  recoverWithoutHold: string;
  recoverAboveHold: string;
  staleAfter: string;
  gateSpacing: string;
}

function duplicateKeys(
  entries: readonly { key: string }[],
  ctx: z.RefinementCtx,
  message: string,
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const key = entry.key.trim();
    if (key === '') continue;
    if (seen.has(key)) {
      ctx.addIssue({ code: 'custom', path: [index, 'key'], message });
    }
    seen.add(key);
  }
}

/** What the editor checks before it saves, as the platform will. */
export function dispatchFormSchema(text: DispatchFormText) {
  const labels = z.array(z.string()).max(DISPATCH_LABELS_MAX, text.labelsMax);
  const key = z
    .string()
    .refine(
      (value) => dispatchRoleKeySchema.safeParse(value.trim()).success,
      text.key,
    );
  return z
    .object({
      enabled: z.boolean(),
      agents: z.array(z.string()).max(DISPATCH_POOL_MAX, text.agentsMax),
      maxConcurrentRuns: z
        .string()
        .refine(
          (value) => wholeNumberIn(value, 1, DISPATCH_RUNS_MAX),
          text.maxConcurrentRuns,
        ),
      perAgentConcurrency: z
        .string()
        .refine(
          (value) => wholeNumberIn(value, 1, DISPATCH_RUNS_MAX),
          text.perAgentConcurrency,
        ),
      statuses: z.enum(DISPATCH_STATUS_ORDERS),
      assignment: z.enum(DISPATCH_ASSIGNMENTS),
      rebalance: z.boolean(),
      labels: z.object({ include: labels, exclude: labels }),
      admission: z.object({
        preset: z.enum(DISPATCH_ADMISSION_PRESETS),
        startSpacingSeconds: z
          .string()
          .refine((value) => wholeNumberIn(value, 0, 3_600), text.startSpacing),
        recheckSeconds: z.string().refine(isRecheckList, text.recheck),
      }),
      standingRoles: z
        .array(
          z.object({
            key,
            agentId: z.string().min(1, text.roleAgent),
            taskId: z.string().min(1, text.roleTask),
            cron: z.string().superRefine((value, ctx) => {
              if (value.trim() === '') {
                ctx.addIssue({ code: 'custom', message: text.cronRequired });
                return;
              }
              const problem = cronProblem(value);
              if (problem !== null) {
                ctx.addIssue({
                  code: 'custom',
                  message: text.cronInvalid(problem),
                });
              }
            }),
            timezone: z
              .string()
              .refine((value) => isValidTimezone(value.trim()), text.timezone),
            mode: z
              .string()
              .refine(
                (value) => value.trim().length <= DISPATCH_ROLE_MODE_MAX,
                text.mode,
              ),
            brief: z
              .string()
              .refine(
                (value) => value.trim().length <= DISPATCH_ROLE_BRIEF_MAX,
                text.brief,
              ),
          }),
        )
        .max(DISPATCH_STANDING_ROLES_MAX)
        .superRefine((roles, ctx) => duplicateKeys(roles, ctx, text.keyTaken)),
      gates: z
        .array(
          z
            .object({
              key,
              labels,
              holdAt: z.string().refine(blankOrNumber, text.number),
              recoverBelow: z.string().refine(blankOrNumber, text.number),
              staleAfterSeconds: z
                .string()
                .refine(
                  (value) => blankOrWholeNumberIn(value, 60, 86_400),
                  text.staleAfter,
                ),
              whenStale: z.enum(DISPATCH_GATE_WHEN_STALE),
              startSpacingSeconds: z
                .string()
                .refine(
                  (value) => blankOrWholeNumberIn(value, 0, 86_400),
                  text.gateSpacing,
                ),
            })
            .superRefine((gate, ctx) => {
              const holdAt = optionalNumber(gate.holdAt);
              const recoverBelow = optionalNumber(gate.recoverBelow);
              if (recoverBelow === undefined || Number.isNaN(recoverBelow)) {
                return;
              }
              if (holdAt === undefined) {
                ctx.addIssue({
                  code: 'custom',
                  path: ['recoverBelow'],
                  message: text.recoverWithoutHold,
                });
              } else if (!Number.isNaN(holdAt) && recoverBelow > holdAt) {
                ctx.addIssue({
                  code: 'custom',
                  path: ['recoverBelow'],
                  message: text.recoverAboveHold,
                });
              }
            }),
        )
        .max(DISPATCH_GATES_MAX)
        .superRefine((gates, ctx) => duplicateKeys(gates, ctx, text.keyTaken)),
    })
    .superRefine((values, ctx) => {
      // One agent holds at most as many runs as the whole pool, as the
      // platform refuses otherwise; each number is checked on its own above.
      if (
        wholeNumberIn(values.maxConcurrentRuns, 1, DISPATCH_RUNS_MAX) &&
        wholeNumberIn(values.perAgentConcurrency, 1, DISPATCH_RUNS_MAX) &&
        Number(values.perAgentConcurrency.trim()) >
          Number(values.maxConcurrentRuns.trim())
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['perAgentConcurrency'],
          message: text.perAgentAboveRuns,
        });
      }
    });
}

/** One refusal of a saved dispatch, by the field of the document it names
 * (`DISPATCH_INVALID`'s `data.issues`). */
export interface DispatchIssue {
  path: string;
  message: string;
}

/** What a refused field is, for the sentence the editor shows under it. */
export type DispatchIssueKind =
  | { kind: 'agent' }
  | { kind: 'roleAgent' }
  | { kind: 'roleTask' }
  | { kind: 'cron' }
  | { kind: 'label'; name: string }
  /** A board it serves, by its place in the list (1-based): the project
   * itself, or a label its filter names there. */
  | { kind: 'sourceProject'; place: number }
  | { kind: 'sourceLabel'; place: number }
  /** A reviewer, by its place in the list (1-based). */
  | { kind: 'reviewer'; place: number }
  | { kind: 'other'; message: string };

/** Where one of the platform's issues belongs in the form, and what kind of
 * problem it is. A label is named from the form, by the place the issue
 * points at; an issue the form has no field for belongs to the form. */
export function placeIssue(
  issue: DispatchIssue,
  values: DispatchFormValues,
): { path: string; problem: DispatchIssueKind } {
  const agent = /^agents\.(\d+)$/.exec(issue.path);
  if (agent !== null) return { path: 'agents', problem: { kind: 'agent' } };
  const label = /^labels\.(include|exclude)\.(\d+)$/.exec(issue.path);
  if (label !== null) {
    const list = label[1] === 'include' ? 'include' : 'exclude';
    return {
      path: `labels.${list}`,
      problem: {
        kind: 'label',
        name: values.labels[list][Number(label[2])] ?? '',
      },
    };
  }
  const gateLabel = /^gates\.(\d+)\.labels\.(\d+)$/.exec(issue.path);
  if (gateLabel !== null) {
    const gate = values.gates[Number(gateLabel[1])];
    return {
      path: `gates.${gateLabel[1]}.labels`,
      problem: {
        kind: 'label',
        name: gate?.labels[Number(gateLabel[2])] ?? '',
      },
    };
  }
  const role = /^standingRoles\.(\d+)\.(agentId|taskId|cron)$/.exec(issue.path);
  if (role !== null) {
    const field = role[2];
    return {
      path: `standingRoles.${role[1]}.${field}`,
      problem: {
        kind:
          field === 'agentId'
            ? 'roleAgent'
            : field === 'taskId'
              ? 'roleTask'
              : 'cron',
      },
    };
  }
  // The boards it serves and its reviewers have no field: their issues
  // belong to the form, each named by its place in its list.
  const source = /^sources\.(\d+)\.(projectId|labels\.)/.exec(issue.path);
  if (source !== null) {
    return {
      path: 'root.server',
      problem: {
        kind: source[2] === 'projectId' ? 'sourceProject' : 'sourceLabel',
        place: Number(source[1]) + 1,
      },
    };
  }
  const reviewer = /^reviewers\.(\d+)$/.exec(issue.path);
  if (reviewer !== null) {
    return {
      path: 'root.server',
      problem: { kind: 'reviewer', place: Number(reviewer[1]) + 1 },
    };
  }
  return {
    path: 'root.server',
    problem: { kind: 'other', message: `${issue.path}: ${issue.message}` },
  };
}

/** The issues a `DISPATCH_INVALID` refusal carries, or none. */
export function dispatchIssuesOf(data: unknown): DispatchIssue[] {
  if (data === null || typeof data !== 'object' || !('issues' in data)) {
    return [];
  }
  const { issues } = data;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) => {
    if (issue === null || typeof issue !== 'object') return [];
    const path: unknown = Reflect.get(issue, 'path');
    const message: unknown = Reflect.get(issue, 'message');
    return typeof path === 'string' && typeof message === 'string'
      ? [{ path, message }]
      : [];
  });
}
