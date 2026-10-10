import { failureDetail } from '@/app/lib/backend/adapters';
import { i18n } from '@/lib/i18n/i18n';
import {
  refusalIssuesSchema,
  type WireAutomationIssue,
} from '@/lib/shared/schemas/automation-issues';

/**
 * Author-facing message for a refused automation write.
 *
 * The store throws structured `AppError`s whose `data.message` already names
 * the problem AND the fix — the deploy gate's "was saved with failing tests —
 * fix them and save a new version", the naming rule a slug broke, the automation
 * that has no version to run. Those sentences are the whole value of the
 * refusal, so they are surfaced verbatim rather than flattened into a generic
 * per-code line.
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
 * The server's own sentence. Without one, the failure's words as every
 * surface reads them (`failureDetail`: a lost connection, a lapsed session),
 * and for a fault that has none the generic sentence — never the error's
 * raw message, which for a structured error is its whole payload.
 */
export function automationErrorMessage(error: unknown): string {
  const message = errorData(error)?.message;
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
