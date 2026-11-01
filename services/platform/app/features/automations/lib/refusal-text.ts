/**
 * How a refused automation write reads to a person, in the session's
 * language.
 *
 * Every `AutomationError` names its refusal by a code from
 * `AUTOMATION_REFUSAL_CODES` and puts the facts its sentence names under
 * `data` (the automation's name, the versions); its English `message` is the
 * API's, the CLI's and the logs'. A person reads the `automations` catalog
 * instead: `refusals.<CODE>`, or for a code with several sentences
 * `refusals.<CODE>.<variant>`, chosen by the facts its data carries. A
 * sentence whose facts the data lacks (an answer from an older server, a
 * refusal only the CLI meets, such as a managed configuration's) reads as its
 * code's general one. The replay refusals read as the replay dialog words them
 * (`automationRuns`, `replay.refusal.<CODE>`).
 *
 * The switch is exhaustive over the code list, so a new code fails the type
 * check until it has words; `lib/i18n/automation-refusal-keys.test.ts` holds
 * every sentence below to its arguments in every locale.
 */

import type { ReplayRefusalCode } from '@/lib/engine/core/record/replay';
import { i18n } from '@/lib/i18n/i18n';
import type { AutomationRefusalCode } from '@/lib/shared/schemas/automation-refusals';

import { humanizeNodeId } from './node-label';

/** Every sentence under `refusals`, and the arguments it reads. */
export const REFUSAL_SENTENCES = {
  APPROVAL_ALLOWANCE_INVALID: [],
  AUTOMATION_DELETED: [],
  AUTOMATION_DELIVERY_SCOPE_MISMATCH: [],
  'AUTOMATION_DEPLOYMENT_STALE.general': [],
  'AUTOMATION_DEPLOYMENT_STALE.gone': ['expected'],
  'AUTOMATION_DEPLOYMENT_STALE.moved': ['live', 'expected'],
  'AUTOMATION_DEPLOYMENT_STALE.movedFromNone': ['live'],
  'AUTOMATION_DEPLOY_REJECTED.general': [],
  'AUTOMATION_DEPLOY_REJECTED.failingTests': ['name', 'version'],
  AUTOMATION_HAS_ACTIVE_RUNS: [],
  'AUTOMATION_INPUT_INVALID.general': [],
  'AUTOMATION_INPUT_INVALID.field': ['field'],
  AUTOMATION_INVALID: [],
  AUTOMATION_NAME_INVALID: [],
  'AUTOMATION_NAME_RESERVED.general': [],
  'AUTOMATION_NAME_RESERVED.first': ['name', 'segment', 'example'],
  'AUTOMATION_NAME_RESERVED.last': ['name', 'segment', 'example'],
  'AUTOMATION_NAME_TAKEN.general': [],
  'AUTOMATION_NAME_TAKEN.named': ['name'],
  AUTOMATION_NOT_DEPLOYED: [],
  AUTOMATION_NOT_FOUND: [],
  AUTOMATION_NOT_INSTALLED: [],
  AUTOMATION_PROJECT_FORBIDDEN: [],
  AUTOMATION_PROJECT_SCOPE_REQUIRED: [],
  AUTOMATION_PROJECT_UNKNOWN: [],
  AUTOMATION_TESTS_FAILING: [],
  'AUTOMATION_TRIGGER_INVALID.general': [],
  'AUTOMATION_TRIGGER_INVALID.slotFreedTaken': [],
  'AUTOMATION_TRIGGER_INVALID.slotFreedTakenNamed': ['name'],
  AUTOMATION_VERSION_NOT_DEPLOYED: [],
  'AUTOMATION_VERSION_STALE.general': [],
  'AUTOMATION_VERSION_STALE.saved': ['name', 'latest', 'base'],
  'AUTOMATION_VERSION_STALE.savedGone': ['name', 'base'],
  'AUTOMATION_VERSION_STALE.deleted': ['name', 'latest', 'expected'],
  'AUTOMATION_VERSION_STALE.deletedGone': ['name'],
  'AUTOMATION_VERSION_UNKNOWN.general': [],
  'AUTOMATION_VERSION_UNKNOWN.withLatest': ['latest'],
  EMPTY_ANSWER: [],
  HUMAN_ASK_EXPIRED: [],
  HUMAN_ASK_NOT_FOUND: [],
  HUMAN_ASK_NOT_PENDING: [],
  IDEMPOTENCY_KEY_REUSED: [],
  IN_DOUBT_ALREADY_RESOLVED: [],
  INVALID_CURSOR: [],
  NODE_RUN_NOT_FOUND: [],
  PROJECT_ARCHIVED: [],
  PROJECT_NOT_FOUND: [],
  RUN_ACTIVE: [],
  RUN_COMPARE_MISMATCH: [],
  RUN_NOT_FOUND: [],
  RUN_NOT_IN_DOUBT: [],
  RUN_QUARANTINED: [],
  RUN_QUARANTINE_CHANGED: [],
  TEMPLATE_ANSWERS_INVALID: [],
  'TEMPLATE_CONNECTION_MISSING.general': [],
  'TEMPLATE_CONNECTION_MISSING.named': ['connectors'],
  TEMPLATE_NOT_FOUND: [],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type RefusalSentenceKey = keyof typeof REFUSAL_SENTENCES;

type Values = Record<string, string | number>;

/** The words one refusal reads as: a sentence of the `refusals` catalog,
 * or a part of the replay dialog's explanation. */
export type RefusalWords =
  | { key: RefusalSentenceKey; values: Values }
  | { replay: ReplayRefusalCode; part: 'title' | 'body'; values: Values };

function text(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function count(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' && Number.isInteger(value)
    ? value
    : undefined;
}

function texts(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function listOf(items: readonly string[]): string {
  return new Intl.ListFormat(i18n.language, {
    style: 'long',
    type: 'conjunction',
  }).format(items);
}

/** The field the first problem of a refused input names: the validator's
 * own words about it are English, the field's name is the author's. */
function firstIssuePath(data: Record<string, unknown>): string | undefined {
  const issues = data.issues;
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  return typeof first === 'object' &&
    first !== null &&
    'path' in first &&
    typeof first.path === 'string' &&
    first.path !== ''
    ? first.path
    : undefined;
}

function say(key: RefusalSentenceKey, values: Values = {}): RefusalWords {
  return { key, values };
}

/** A replay refusal as the replay dialog explains it: its body when the
 * refusal names the steps the body reads, else its title. */
function replayWords(
  code: ReplayRefusalCode,
  data: Record<string, unknown>,
): RefusalWords {
  const steps = texts(data, 'nodes').map(humanizeNodeId);
  switch (code) {
    case 'REPLAY_NODE_UNKNOWN':
      return steps[0] === undefined
        ? { replay: code, part: 'title', values: {} }
        : { replay: code, part: 'body', values: { step: steps[0] } };
    case 'REPLAY_GRAPH_CHANGED':
      return steps.length === 0
        ? { replay: code, part: 'title', values: {} }
        : { replay: code, part: 'body', values: { nodes: listOf(steps) } };
    default:
      return { replay: code, part: 'body', values: {} };
  }
}

/** The words for one refusal, chosen by its code and the facts its data
 * carries. */
export function refusalWords(
  code: AutomationRefusalCode,
  data: Record<string, unknown> = {},
): RefusalWords {
  const name = text(data, 'name');
  switch (code) {
    case 'AUTOMATION_VERSION_STALE': {
      const latest = data.latestVersion;
      const base = count(data, 'baseVersion');
      const expected = count(data, 'expectedLatestVersion');
      if (name === undefined || (base === undefined && expected === undefined))
        return say('AUTOMATION_VERSION_STALE.general');
      if (latest === null) {
        return base === undefined
          ? say('AUTOMATION_VERSION_STALE.deletedGone', { name })
          : say('AUTOMATION_VERSION_STALE.savedGone', { name, base });
      }
      if (typeof latest !== 'number')
        return say('AUTOMATION_VERSION_STALE.general');
      return base === undefined
        ? say('AUTOMATION_VERSION_STALE.deleted', {
            name,
            latest,
            expected: expected ?? 0,
          })
        : say('AUTOMATION_VERSION_STALE.saved', { name, latest, base });
    }
    case 'AUTOMATION_DEPLOYMENT_STALE': {
      const live = data.deployedVersion;
      const expected = data.expectedDeployedVersion;
      if (live === null && typeof expected === 'number')
        return say('AUTOMATION_DEPLOYMENT_STALE.gone', { expected });
      if (typeof live === 'number' && typeof expected === 'number')
        return say('AUTOMATION_DEPLOYMENT_STALE.moved', { live, expected });
      if (typeof live === 'number' && expected === null)
        return say('AUTOMATION_DEPLOYMENT_STALE.movedFromNone', { live });
      return say('AUTOMATION_DEPLOYMENT_STALE.general');
    }
    case 'AUTOMATION_DEPLOY_REJECTED': {
      const version = count(data, 'version');
      return name === undefined || version === undefined
        ? say('AUTOMATION_DEPLOY_REJECTED.general')
        : say('AUTOMATION_DEPLOY_REJECTED.failingTests', { name, version });
    }
    case 'AUTOMATION_NAME_RESERVED': {
      const segment = text(data, 'segment');
      if (name === undefined || segment === undefined)
        return say('AUTOMATION_NAME_RESERVED.general');
      if (data.position === 'first')
        return say('AUTOMATION_NAME_RESERVED.first', {
          name,
          segment,
          example: `ops/${name}`,
        });
      if (data.position === 'last')
        return say('AUTOMATION_NAME_RESERVED.last', {
          name,
          segment,
          example: `${name}-flow`,
        });
      return say('AUTOMATION_NAME_RESERVED.general');
    }
    case 'AUTOMATION_INPUT_INVALID': {
      const field = firstIssuePath(data);
      return field === undefined
        ? say('AUTOMATION_INPUT_INVALID.general')
        : say('AUTOMATION_INPUT_INVALID.field', { field });
    }
    case 'AUTOMATION_NAME_TAKEN':
      return name === undefined
        ? say('AUTOMATION_NAME_TAKEN.general')
        : say('AUTOMATION_NAME_TAKEN.named', { name });
    case 'AUTOMATION_TRIGGER_INVALID':
      if (data.reason !== 'slot_freed_taken')
        return say('AUTOMATION_TRIGGER_INVALID.general');
      return name === undefined
        ? say('AUTOMATION_TRIGGER_INVALID.slotFreedTaken')
        : say('AUTOMATION_TRIGGER_INVALID.slotFreedTakenNamed', { name });
    case 'AUTOMATION_VERSION_UNKNOWN': {
      const latest = count(data, 'latestVersion');
      return latest === undefined
        ? say('AUTOMATION_VERSION_UNKNOWN.general')
        : say('AUTOMATION_VERSION_UNKNOWN.withLatest', { latest });
    }
    case 'TEMPLATE_CONNECTION_MISSING': {
      const connectors = texts(data, 'connectors');
      return connectors.length === 0
        ? say('TEMPLATE_CONNECTION_MISSING.general')
        : say('TEMPLATE_CONNECTION_MISSING.named', {
            connectors: listOf(connectors),
          });
    }
    case 'REPLAY_GRAPH_CHANGED':
    case 'REPLAY_INPUT_UNAVAILABLE':
    case 'REPLAY_MODE_MISMATCH':
    case 'REPLAY_NODE_UNKNOWN':
    case 'REPLAY_PROGRESS_UNREADABLE':
    case 'REPLAY_RUN_NOT_FINISHED':
      return replayWords(code, data);
    case 'APPROVAL_ALLOWANCE_INVALID':
    case 'AUTOMATION_DELETED':
    case 'AUTOMATION_DELIVERY_SCOPE_MISMATCH':
    case 'AUTOMATION_HAS_ACTIVE_RUNS':
    case 'AUTOMATION_INVALID':
    case 'AUTOMATION_NAME_INVALID':
    case 'AUTOMATION_NOT_DEPLOYED':
    case 'AUTOMATION_NOT_FOUND':
    case 'AUTOMATION_NOT_INSTALLED':
    case 'AUTOMATION_PROJECT_FORBIDDEN':
    case 'AUTOMATION_PROJECT_SCOPE_REQUIRED':
    case 'AUTOMATION_PROJECT_UNKNOWN':
    case 'AUTOMATION_TESTS_FAILING':
    case 'AUTOMATION_VERSION_NOT_DEPLOYED':
    case 'EMPTY_ANSWER':
    case 'HUMAN_ASK_EXPIRED':
    case 'HUMAN_ASK_NOT_FOUND':
    case 'HUMAN_ASK_NOT_PENDING':
    case 'IDEMPOTENCY_KEY_REUSED':
    case 'IN_DOUBT_ALREADY_RESOLVED':
    case 'INVALID_CURSOR':
    case 'NODE_RUN_NOT_FOUND':
    case 'PROJECT_ARCHIVED':
    case 'PROJECT_NOT_FOUND':
    case 'RUN_ACTIVE':
    case 'RUN_COMPARE_MISMATCH':
    case 'RUN_NOT_FOUND':
    case 'RUN_NOT_IN_DOUBT':
    case 'RUN_QUARANTINED':
    case 'RUN_QUARANTINE_CHANGED':
    case 'TEMPLATE_ANSWERS_INVALID':
    case 'TEMPLATE_NOT_FOUND':
      return say(code);
    default: {
      const exhaustive: never = code;
      return exhaustive;
    }
  }
}

/** One refusal as one sentence in the session's language. */
export function automationRefusalText(
  code: AutomationRefusalCode,
  data?: Record<string, unknown>,
): string {
  const words = refusalWords(code, data);
  return 'replay' in words
    ? i18n.t(`replay.refusal.${words.replay}.${words.part}`, {
        ns: 'automationRuns',
        ...words.values,
      })
    : i18n.t(`refusals.${words.key}`, { ns: 'automations', ...words.values });
}
