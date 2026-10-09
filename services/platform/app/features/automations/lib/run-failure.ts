/**
 * Why a run, or one of its steps, failed — as a person reads it, in the
 * session's language.
 *
 * The engine names a step's failure by a stable reason and gives the facts
 * its sentence is built from as params (`lib/engine/core/record/failure.ts`,
 * `STEP_FAILURE_META`); the run names its family by a code
 * (`Run.failureCode`). Their `message` stays the engine's English, for the
 * technical details. A person reads the `automationRuns` catalog instead —
 * for a step's reason a short title, what it means, the concrete cause and
 * the fix (`runtime.codes`), for a run's code its title, meaning and fix
 * (`runFailure.codes`) — interpolated with the params this module prepares,
 * named the way the canvas and the inspector name things. A model
 * provider's or an agent's failure leads with its run-level code, which
 * says more than "the provider failed"; a reason this build does not know
 * (a newer server) reads as the run's code.
 */

import {
  isRunFailureCode as isKnownRunCode,
  type RunFailureCode,
} from '@/backend/core/automations/failure';
import {
  STEP_FAILURE_META,
  type StepFailureReason,
} from '@/lib/engine/core/record/failure';
import type { StepFailure } from '@/lib/engine/core/record/types';
import { formatDurationWords } from '@/lib/utils/format/duration';

import {
  fieldLabel,
  type IssueTranslate,
  kindLabel,
  quote,
} from './issue-text';
import { nodeTitle } from './node-face';

/** The sentences a person reads for one failure. */
export interface FailureText {
  /** Short, the same for every failure of its reason or code. */
  title: string;
  /** What the reason or code means. */
  explanation: string;
  /** This failure's concrete case; empty for a run's code alone and for a
   * reason this build has no words for. */
  cause: string;
  /** What to do about it. */
  fix: string;
  /** False when this build has no words for it: then the words are the
   * run's code's, or generic, and the engine's English belongs to the
   * technical details. */
  known: boolean;
}

export interface FailureTextContext {
  locale: string;
  t: IssueTranslate;
  /** A connector's display name in the reader's language; the catalog name
   * as written when it has none. */
  connectorLabel?: (connector: string) => string | undefined;
  /** A connector action's title (`github.list_issues` → "List issues"). */
  actionLabel?: (type: string) => string | undefined;
  /** A served model's display name. */
  modelLabel?: (id: string) => string | undefined;
  /** An agent runtime's product name (`claude-code` → "Claude Code"). */
  harnessLabel?: (harness: string) => string | undefined;
}

type TextValues = Record<string, string | number>;

/** Params a sentence counts with: they stay numbers, so the catalog formats
 * and pluralizes them. Every other param is text. */
const COUNT_PARAMS: ReadonlySet<string> = new Set(['attempts', 'limit', 'max']);

/** What each param is read as, beside itself. */
const DERIVED_BY_PARAM: Readonly<Record<string, readonly string[]>> = {
  field: ['fieldLabel'],
  key: ['keyLabel'],
  name: ['nameLabel'],
  source: ['sourceLabel'],
  chain: ['suggestion'],
  limitMs: ['limit'],
  kind: ['kindLabel'],
  connector: ['connectorLabel'],
  action: ['actionLabel'],
  property: ['propertyLabel'],
  model: ['modelLabel'],
  harness: ['harnessLabel'],
  automation: ['automationLabel'],
  childPath: ['childLabel'],
};

function isStepFailureReason(reason: string): reason is StepFailureReason {
  return Object.hasOwn(STEP_FAILURE_META, reason);
}

function sentenceParams(reason: StepFailureReason): readonly string[] {
  const meta = STEP_FAILURE_META[reason];
  const technical = new Set(meta.technical ?? []);
  return [...meta.params, ...(meta.optional ?? [])].filter(
    (name) => !technical.has(name),
  );
}

function derivedParamsOf(reason: StepFailureReason): readonly string[] {
  return sentenceParams(reason).flatMap((name) => DERIVED_BY_PARAM[name] ?? []);
}

/**
 * The params each reason's `cause` and `fix` may use beside its own
 * `STEP_FAILURE_META` params: names prepared for reading. `fieldLabel`,
 * `keyLabel`, `nameLabel`, `actionLabel`, `propertyLabel` and
 * `automationLabel` are in the language's quotes; `sourceLabel` and
 * `childLabel` name a step the way the canvas titles it, in quotes; `connectorLabel`,
 * `modelLabel` and `harnessLabel` are display names; `kindLabel` says what
 * kind of value it was ("a number"); `limit` words a time limit ("5
 * seconds"); `suggestion` is the read written so it cannot fail. One a
 * failure leaves out reads `none`, so a sentence can `select` on it.
 */
export const RUN_FAILURE_DERIVED_PARAMS: Readonly<
  Record<StepFailureReason, readonly string[]>
> =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- one entry per key of STEP_FAILURE_META, which the mapped type makes exactly the reasons
  Object.fromEntries(
    Object.keys(STEP_FAILURE_META)
      .filter(isStepFailureReason)
      .map((reason) => [reason, derivedParamsOf(reason)]),
  ) as Record<StepFailureReason, readonly string[]>;

/** Every key of this module's catalog names its namespace here. */
function say(t: IssueTranslate, key: string, values: TextValues = {}): string {
  return t(key, { ...values, ns: 'automationRuns' });
}

function asText(value: StepFailure['params'][string] | undefined) {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

/** The read written with `?.`, so a missing value gives `undefined`. */
function optionalRead(chain: string, key: string): string {
  return IDENTIFIER_RE.test(key)
    ? `${chain}?.${key}`
    : `${chain}?.[${JSON.stringify(key)}]`;
}

/** A JSON pointer into the input (`/to/0`) as an author writes the field
 * (`to.0`). */
function propertyOf(pointer: string): string | undefined {
  const path = pointer
    .split('/')
    .slice(1)
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.');
  return path === '' ? undefined : path;
}

/** `github.list_issues` → its title in the catalog, else "List issues". */
function actionTitle(type: string, ctx: FailureTextContext): string {
  const known = ctx.actionLabel?.(type);
  if (known !== undefined) return known;
  const dot = type.indexOf('.');
  return nodeTitle(dot === -1 ? type : type.slice(dot + 1));
}

function derive(
  name: string,
  text: string | undefined,
  failure: StepFailure,
  ctx: FailureTextContext,
): TextValues {
  const { t } = ctx;
  const none = text === undefined;
  switch (name) {
    case 'field':
      return { fieldLabel: none ? 'none' : fieldLabel(t, text) };
    case 'key':
      return { keyLabel: none ? 'none' : quote(t, text) };
    case 'name':
      return { nameLabel: none ? 'none' : quote(t, text) };
    case 'source':
      return { sourceLabel: none ? 'none' : quote(t, nodeTitle(text)) };
    case 'chain': {
      const key = asText(failure.params.key);
      return {
        suggestion:
          none || key === undefined ? 'none' : optionalRead(text, key),
      };
    }
    case 'limitMs': {
      const ms = failure.params.limitMs;
      return {
        limit:
          typeof ms === 'number' ? formatDurationWords(ms, ctx.locale) : 'none',
      };
    }
    case 'kind':
      return { kindLabel: kindLabel(t, text ?? 'other') };
    case 'connector':
      return {
        connectorLabel: none ? 'none' : (ctx.connectorLabel?.(text) ?? text),
      };
    case 'action':
      return { actionLabel: none ? 'none' : quote(t, actionTitle(text, ctx)) };
    case 'property': {
      const property = none ? undefined : propertyOf(text);
      return {
        propertyLabel: property === undefined ? 'none' : quote(t, property),
      };
    }
    case 'model':
      return { modelLabel: none ? 'none' : (ctx.modelLabel?.(text) ?? text) };
    case 'harness':
      return {
        harnessLabel: none ? 'none' : (ctx.harnessLabel?.(text) ?? text),
      };
    case 'automation':
      return { automationLabel: none ? 'none' : quote(t, text) };
    case 'childPath':
      return { childLabel: none ? 'none' : quote(t, nodeTitle(text)) };
    default:
      return {};
  }
}

/**
 * The values a reason's sentences interpolate: the failure's params, made
 * selectable and readable, plus the derived params
 * ({@link RUN_FAILURE_DERIVED_PARAMS}). An optional param the failure leaves
 * out reads `none`; technical params (an engine's or a service's own
 * English) are left out entirely.
 */
export function failureParamsForText(
  failure: StepFailure,
  ctx: FailureTextContext,
): TextValues {
  if (!isStepFailureReason(failure.reason)) return {};
  const values: TextValues = {};
  for (const name of sentenceParams(failure.reason)) {
    const value = failure.params[name];
    const text = asText(value);
    values[name] =
      COUNT_PARAMS.has(name) && typeof value === 'number'
        ? value
        : (text ?? 'none');
    Object.assign(values, derive(name, text, failure, ctx));
  }
  return values;
}

/** Whether `code` is a run failure code this build has words for. */
export function isRunFailureCode(
  code: string | null | undefined,
): code is RunFailureCode {
  return code !== null && code !== undefined && isKnownRunCode(code);
}

/** The title, meaning and fix of a run's failure code; generic words for no
 * code, or one this build does not know. */
export function runFailureText(
  code: string | null | undefined,
  ctx: Pick<FailureTextContext, 't'>,
): FailureText {
  if (!isRunFailureCode(code)) {
    return {
      title: say(ctx.t, 'runFailure.unknown.title'),
      explanation: say(ctx.t, 'runFailure.unknown.explanation'),
      cause: '',
      fix: say(ctx.t, 'runFailure.unknown.fix'),
      known: false,
    };
  }
  return {
    title: say(ctx.t, `runFailure.codes.${code}.title`),
    explanation: say(ctx.t, `runFailure.codes.${code}.explanation`),
    cause: '',
    fix: say(ctx.t, `runFailure.codes.${code}.fix`),
    known: true,
  };
}

/** The run-level code whose words say more than the reason's own: a model
 * provider's or an agent's code, or the family of a failure the engine
 * could not name. */
function leadingCode(failure: StepFailure): RunFailureCode | undefined {
  const { reason, code } = failure;
  if (
    reason !== 'LLM_PROVIDER' &&
    reason !== 'AGENT_FAILED' &&
    reason !== 'UNKNOWN'
  ) {
    return undefined;
  }
  return isRunFailureCode(code) && code !== 'node_error' ? code : undefined;
}

/** Title, meaning, cause and fix of a step's failure, in `ctx`'s language. */
export function stepFailureText(
  failure: StepFailure,
  ctx: FailureTextContext,
): FailureText {
  const reason = failure.reason;
  if (!isStepFailureReason(reason)) {
    return { ...runFailureText(failure.code, ctx), known: false };
  }
  const values = failureParamsForText(failure, ctx);
  const cause = say(ctx.t, `runtime.codes.${reason}.cause`, values);
  const lead = leadingCode(failure);
  if (lead !== undefined) {
    return { ...runFailureText(lead, ctx), cause };
  }
  return {
    title: say(ctx.t, `runtime.codes.${reason}.title`),
    explanation: say(ctx.t, `runtime.codes.${reason}.explanation`),
    cause,
    fix: say(ctx.t, `runtime.codes.${reason}.fix`, values),
    known: true,
  };
}
