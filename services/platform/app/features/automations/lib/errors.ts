import { failureDetail } from '@/app/lib/backend/adapters';
import { i18n } from '@/lib/i18n/i18n';
import {
  refusalIssuesSchema,
  type WireAutomationIssue,
} from '@/lib/shared/schemas/automation-issues';
import { isAutomationRefusalCode } from '@/lib/shared/schemas/automation-refusals';
import {
  type AutomationWriteVia,
  isAutomationWriteVia,
} from '@/lib/shared/schemas/automation-versions';

import { automationRefusalText } from './refusal-text';

/**
 * Author-facing message for a refused automation write, in the reader's
 * language.
 *
 * The store refuses with a code from `AUTOMATION_REFUSAL_CODES` and puts the
 * facts its sentence names under `data`: the deploy gate's version that was
 * saved with failing tests, the name a slug broke the naming rule with, the
 * version a stale save missed. `automationRefusalText` words each in the
 * `automations` catalog, the problem AND the fix; the server's English
 * sentence is the API's, the CLI's and the logs'.
 *
 * Duck-types `AppError.data` rather than using `instanceof`: Vite chunk
 * splitting can produce more than one copy of the class, which breaks the
 * prototype check even though the value IS a AppError.
 */

function errorData(error: unknown): Record<string, unknown> | undefined {
  if (error === null || typeof error !== 'object' || !('data' in error)) {
    return undefined;
  }
  const { data } = error;
  return data !== null && typeof data === 'object' && !Array.isArray(data)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
      (data as Record<string, unknown>)
    : undefined;
}

/**
 * `failureDetail` for an automation door: a refusal's words in the reader's
 * language when the store refused with one of its codes, else the failure's
 * words as every surface reads them — `undefined` when it has none, so a
 * surface keeps its own line for that case.
 */
export function automationFailureDetail(error: unknown): string | undefined {
  const data = errorData(error);
  return data !== undefined && isAutomationRefusalCode(data.code)
    ? automationRefusalText(data.code, data)
    : failureDetail(error);
}

/**
 * A refusal's words in the reader's language, chosen by its code and data.
 * The server's own sentence only for a code this build does not know (a
 * newer server). Without one, the failure's words as every surface reads
 * them (`failureDetail`: a lost connection, a lapsed session), and for a
 * fault that has none the generic sentence — never the error's raw message,
 * which for a structured error is its whole payload.
 */
export function automationErrorMessage(error: unknown): string {
  const data = errorData(error);
  if (data !== undefined && isAutomationRefusalCode(data.code)) {
    return automationRefusalText(data.code, data);
  }
  const message = data?.message;
  if (typeof message === 'string' && message.length > 0) return message;
  return failureDetail(error) ?? i18n.t('errors.generic', { ns: 'common' });
}

/** The problems a refused save or deploy listed, split by level. */
export interface AutomationErrorIssues {
  errors: WireAutomationIssue[];
  warnings: WireAutomationIssue[];
}

/**
 * The issues a refusal carries (`AUTOMATION_INVALID`: the save or deploy
 * gate found errors), read through the wire schema. `undefined` when the
 * error carries none, or carries them in a shape this build does not read —
 * then the refusal's sentence is all there is to show.
 */
export function automationErrorIssues(
  error: unknown,
): AutomationErrorIssues | undefined {
  const data = errorData(error);
  if (data === undefined) return undefined;
  if (data.errors === undefined && data.warnings === undefined) {
    return undefined;
  }
  const parsed = refusalIssuesSchema.safeParse({
    errors: data.errors,
    warnings: data.warnings,
  });
  if (!parsed.success) {
    console.warn(
      '[automations] a refusal listed its problems in a shape this app does not read',
      parsed.error.issues,
    );
    return undefined;
  }
  const errors = parsed.data.errors ?? [];
  const warnings = parsed.data.warnings ?? [];
  if (errors.length === 0 && warnings.length === 0) return undefined;
  return { errors, warnings };
}

/** How many tests failed in the check that refused a deploy
 * (`AUTOMATION_TESTS_FAILING`); undefined when the refusal says no count. */
export function automationErrorFailedTests(error: unknown): number | undefined {
  const report = errorData(error)?.report;
  if (typeof report !== 'object' || report === null) return undefined;
  const failed = (report as { failed?: unknown }).failed;
  return typeof failed === 'number' && Number.isInteger(failed) && failed > 0
    ? failed
    : undefined;
}

/** One problem a refused trigger save named (`AUTOMATION_TRIGGER_INVALID`). */
export interface TriggerRefusalIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * The problems a refused trigger save names under `data.issues`, or
 * undefined when the refusal carries none in that shape.
 */
export function automationTriggerIssues(
  error: unknown,
): TriggerRefusalIssue[] | undefined {
  const issues = errorData(error)?.issues;
  if (!Array.isArray(issues)) return undefined;
  const read = issues.flatMap((issue: unknown): TriggerRefusalIssue[] => {
    if (typeof issue !== 'object' || issue === null || !('code' in issue)) {
      return [];
    }
    const { code } = issue;
    const path = 'path' in issue ? issue.path : undefined;
    const message = 'message' in issue ? issue.message : undefined;
    return typeof code === 'string'
      ? [
          {
            path: typeof path === 'string' ? path : '',
            code,
            message: typeof message === 'string' ? message : '',
          },
        ]
      : [];
  });
  return read.length === 0 ? undefined : read;
}

/** The machine code the store attached, for branching on a refusal kind. */
/** One answer a create from a starter could not use. */
export interface StarterAnswerIssue {
  field: string;
  code: string;
}

/** The answers a refused create from a starter names
 * (`TEMPLATE_ANSWERS_INVALID`, `data.fields`), or undefined. */
export function automationAnswerIssues(
  error: unknown,
): StarterAnswerIssue[] | undefined {
  const fields = errorData(error)?.fields;
  if (!Array.isArray(fields)) return undefined;
  const read = fields.flatMap((entry: unknown): StarterAnswerIssue[] =>
    typeof entry === 'object' &&
    entry !== null &&
    'field' in entry &&
    'code' in entry &&
    typeof entry.field === 'string' &&
    typeof entry.code === 'string'
      ? [{ field: entry.field, code: entry.code }]
      : [],
  );
  return read.length === 0 ? undefined : read;
}

export function automationErrorCode(error: unknown): string | undefined {
  const code = errorData(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The version that landed while a draft was open — the detail a stale save
 * (`AUTOMATION_VERSION_STALE`) carries so the editor can save on top of it.
 * `null` when the automation has no version any more; `undefined` when the
 * error carries no such detail.
 */
export function automationErrorLatestVersion(
  error: unknown,
): number | null | undefined {
  const latest = errorData(error)?.latestVersion;
  return typeof latest === 'number' || latest === null ? latest : undefined;
}

/**
 * Who changed an automation while a caller acted on what it had read: the
 * version live now, or the latest version, who put it there, when, through
 * which door and client — as far as the refusal says.
 */
export interface StaleChange {
  /** The version live now (a deploy) or the latest one (a save or a
   * restore); null when there is none any more. */
  version: number | null;
  by: string | null;
  at: number | null;
  via: AutomationWriteVia | null;
  client: string | null;
}

function staleChange(
  version: unknown,
  by: unknown,
  at: unknown,
  via: unknown,
  client: unknown,
): StaleChange {
  return {
    version: typeof version === 'number' ? version : null,
    by: typeof by === 'string' && by !== '' ? by : null,
    at: typeof at === 'number' ? at : null,
    via: typeof via === 'string' && isAutomationWriteVia(via) ? via : null,
    client: typeof client === 'string' && client !== '' ? client : null,
  };
}

/** What a deploy that expected another live version
 * (`AUTOMATION_DEPLOYMENT_STALE`) found live; undefined for any other
 * refusal. */
export function automationDeploymentStale(
  error: unknown,
): StaleChange | undefined {
  const data = errorData(error);
  if (data?.code !== 'AUTOMATION_DEPLOYMENT_STALE') return undefined;
  return staleChange(
    data.deployedVersion,
    data.deployedBy,
    data.deployedAt,
    data.deployedVia,
    data.deployedClient,
  );
}

/** The version a save or a restore that started from an older latest
 * (`AUTOMATION_VERSION_STALE`) found saved since; undefined for any other
 * refusal. */
export function automationVersionStale(
  error: unknown,
): StaleChange | undefined {
  const data = errorData(error);
  if (data?.code !== 'AUTOMATION_VERSION_STALE') return undefined;
  return staleChange(
    data.latestVersion,
    data.latestCreatedBy,
    data.latestCreatedAt,
    data.latestVia,
    data.latestClient,
  );
}

/**
 * When the automation a read named was deleted — the `deletedAt` the
 * `AUTOMATION_DELETED` refusal carries from the tombstone. Undefined for
 * any other refusal: a never-saved name reads as plain not-found.
 */
export function automationDeletedAt(error: unknown): number | undefined {
  const data = errorData(error);
  if (data?.code !== 'AUTOMATION_DELETED') return undefined;
  return typeof data.deletedAt === 'number' ? data.deletedAt : undefined;
}

/**
 * A read that answered "no such thing". The store answers `null` for a row it
 * cannot see; the backend's route answers 404, which the fetch layer surfaces
 * as a structured refusal (the route's `error` string as the code) rather
 * than as `null` data — and a foreign or mistyped id reads exactly the same,
 * never a leak. A transport or server failure carries no structured code and
 * is NOT missing: it keeps its own error state.
 */
export function isMissingAutomationRead(query: {
  data: unknown;
  isError: boolean;
  error: unknown;
}): boolean {
  if (query.data === null) return true;
  return query.isError && automationErrorCode(query.error) !== undefined;
}
