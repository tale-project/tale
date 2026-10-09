/**
 * Why a step failed, as a stable reason a reader can explain in their own
 * language: set where the failure is raised, never read back out of our own
 * English. The run-level `code` (`Run.failureCode`) names the family an
 * integrator branches on; the reason names the cause within it.
 *
 * An expression runs in another process, so the JavaScript engine's message
 * is all that crosses back from it; {@link exprFailureOf} reads that message
 * at the one place it arrives.
 */

import { cutText, storableText } from '../../../shared/utils/storable-text';
import { credentialKind } from '../secret-patterns';
import {
  FAILURE_PARAM_LENGTH,
  type EvalTrace,
  type FailureParams,
  type StepFailure,
} from './types';

/** The most of the engine's own failure sentence a record keeps (as much
 * as a run's detail does). */
const FAILURE_MESSAGE_LENGTH = 4096;

/** Every reason a step can fail with. A newer server may answer a reason an
 * older reader does not know; readers fall back to the run-level code. */
export const STEP_FAILURE_REASONS = [
  'EXPR_SYNTAX',
  'EXPR_READ_MISSING',
  'EXPR_NAME_UNKNOWN',
  'EXPR_NOT_FUNCTION',
  'EXPR_FAILED',
  'EXPR_TIMEOUT',
  'TEMPLATE_VALUE_MISSING',
  'FOREACH_NOT_LIST',
  'CODE_NO_RESULT',
  'CODE_FAILED',
  'CODE_TIMEOUT',
  'CONNECTOR_CREDENTIAL_MISSING',
  'CONNECTOR_INPUT_REFUSED',
  'CONNECTOR_AUTH',
  'CONNECTOR_NOT_FOUND',
  'CONNECTOR_RATE_LIMITED',
  'CONNECTOR_UNREACHABLE',
  'CONNECTOR_FAILED',
  'LLM_OUTPUT_INVALID',
  'LLM_PROVIDER',
  'AGENT_FAILED',
  'SUBAUTOMATION_FAILED',
  'SUBAUTOMATION_INPUT_REFUSED',
  'SUBAUTOMATION_NOT_FOUND',
  'SUBAUTOMATION_TOO_DEEP',
  'APPROVAL_REJECTED',
  'EXECUTION_LIMIT',
  'EFFECT_IN_DOUBT_FAILED',
  'UNKNOWN',
] as const;

export type StepFailureReason = (typeof STEP_FAILURE_REASONS)[number];

/**
 * The run-level family of a reason, for a run that has no runtime of its
 * own to name it (the in-process executor): the durable runtime names the
 * family itself, from the error it caught.
 */
export function reasonFamily(reason: string): string {
  if (reason.startsWith('CONNECTOR_')) return 'connector_error';
  switch (reason) {
    case 'LLM_OUTPUT_INVALID':
      return 'llm_output_invalid';
    case 'EXECUTION_LIMIT':
      return 'execution_limit';
    case 'APPROVAL_REJECTED':
      return 'approval_rejected';
    case 'EFFECT_IN_DOUBT_FAILED':
      return 'effect_in_doubt';
    default:
      return 'node_error';
  }
}

/**
 * The cause of a connector call that failed: refused credentials, a missing
 * resource or a rate limit by the status the connector answered, a network
 * that never answered, or any other failure.
 */
export function connectorFailureOf(
  error: unknown,
  connector: string,
  action: string,
): FailureCause {
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const params = { connector, action };
  if (status === 401 || status === 403) {
    return { reason: 'CONNECTOR_AUTH', params: { ...params, status } };
  }
  if (status === 404) {
    return { reason: 'CONNECTOR_NOT_FOUND', params: { ...params, status } };
  }
  if (status === 429) {
    return { reason: 'CONNECTOR_RATE_LIMITED', params: { ...params, status } };
  }
  if (status === undefined && UNREACHABLE_RE.test(message)) {
    return { reason: 'CONNECTOR_UNREACHABLE', params };
  }
  return {
    reason: 'CONNECTOR_FAILED',
    params: {
      ...params,
      ...(status !== undefined && { status }),
      detail: message,
    },
  };
}

const UNREACHABLE_RE =
  /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|network (?:error|request failed)|socket hang up/i;

/** What a failure site knows about its cause: everything a {@link StepFailure}
 * holds but the run-level code and the English, which the run's own catch
 * supplies. */
export interface FailureCause {
  reason: StepFailureReason;
  params: FailureParams;
  at?: FailureAt;
  trace?: EvalTrace;
}

export type FailureAt = NonNullable<StepFailure['at']>;

/** Whether `value` carries a {@link FailureCause} (an `ExprError`, or a host
 * failure that learned its cause). */
export function failureCauseOf(value: unknown): FailureCause | undefined {
  if (typeof value !== 'object' || value === null || !('failure' in value)) {
    return undefined;
  }
  const failure = value.failure;
  if (
    typeof failure === 'object' &&
    failure !== null &&
    'reason' in failure &&
    typeof failure.reason === 'string' &&
    'params' in failure &&
    typeof failure.params === 'object' &&
    failure.params !== null
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape checked above; only engine code sets `failure`
    return failure as FailureCause;
  }
  return undefined;
}

/**
 * The record of a step's failure: the cause its site gave, else `UNKNOWN`
 * with the error's text as a technical detail. Parameters have secrets
 * withheld and are cut to {@link FAILURE_PARAM_LENGTH} characters; the place
 * defaults to the step itself.
 */
export function classifyStepFailure(
  error: unknown,
  ctx: { code: string; message: string; hint?: string; pointer?: string },
): StepFailure {
  const cause = failureCauseOf(error) ?? {
    reason: 'UNKNOWN' as const,
    params: { detail: ctx.message },
  };
  const at =
    cause.at ??
    (ctx.pointer === undefined ? undefined : { pointer: ctx.pointer });
  return {
    code: ctx.code,
    reason: cause.reason,
    params: cleanParams(cause.params),
    // The engine's sentence, shown under the technical details: as much as
    // a run's detail keeps, and storable whatever text it quotes.
    message: storableText(cutText(ctx.message, FAILURE_MESSAGE_LENGTH)),
    ...(ctx.hint !== undefined && { hint: ctx.hint }),
    ...(at !== undefined && { at }),
    ...(cause.trace !== undefined && { trace: cause.trace }),
  };
}

function cleanParams(params: FailureParams): FailureParams {
  const out: FailureParams = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string') out[name] = cleanText(value);
    else if (Array.isArray(value)) {
      out[name] = value
        .slice(0, 20)
        .map((item: string) => cleanText(item) ?? '');
    } else out[name] = value;
  }
  return out;
}

function cleanText(text: string): string | null {
  if (credentialKind(text) !== undefined) return null;
  return storableText(cutText(text, FAILURE_PARAM_LENGTH));
}

const READ_MISSING_RE =
  /Cannot read propert(?:y|ies) of (null|undefined) \(reading '((?:[^'\\]|\\.)*)'\)/;
const READ_MISSING_LEGACY_RE =
  /Cannot read property '((?:[^'\\]|\\.)*)' of (null|undefined)/;
const NAME_UNKNOWN_RE = /(?:^|: )([A-Za-z_$][\w$]*) is not defined\b/;
const NOT_FUNCTION_RE =
  /^(?:(?:Type|Reference|Range|Syntax|Eval|URI)?Error: )?(.+?) is not a function\b/;
const TIMEOUT_RE = /timed out after (\d+)\s*ms/;
const SYNTAX_RE =
  /\bSyntaxError\b|^(?:Unexpected (?:token|identifier|end of input|string|number)|Invalid or unexpected token|missing \) after|Unterminated |Invalid regular expression|Invalid left-hand side)/;
const ERROR_NAME_RE = /\b((?:Type|Reference|Range|Syntax|Eval|URI)?Error): /;

/** Where an expression sits: the field's pointer, the unit's range in the
 * field's text, and the field as a reader names it. */
export interface ExprWhere {
  pointer: string;
  range?: [number, number];
}

/**
 * The cause of an expression that threw, read from the JavaScript engine's
 * own message (the evaluation runs in another process, so only the message
 * crosses back): a member read of `null`/`undefined`, an unknown name, a
 * call of something that is not a function, a timeout, a syntax error, or
 * any other throw. `readsOf` names the static reads of the expression, so a
 * missing value can be traced to the chain that read it.
 */
export function exprFailureOf(
  message: string,
  expr: string,
  where: ExprWhere | undefined,
  readsOf?: (
    expr: string,
  ) => ReadonlyArray<{ chain: string; key: string; source?: string }>,
): FailureCause {
  const field = where === undefined ? undefined : fieldOf(where.pointer);
  const base = {
    ...(field !== undefined && { field }),
  };
  const at = where === undefined ? undefined : { ...where };
  const withAt = (cause: Omit<FailureCause, 'at'>): FailureCause =>
    at === undefined ? cause : { ...cause, at };

  const timeout = TIMEOUT_RE.exec(message);
  if (timeout !== null) {
    return withAt({
      reason: 'EXPR_TIMEOUT',
      params: { ...base, limitMs: Number(timeout[1]) },
    });
  }
  const read = READ_MISSING_RE.exec(message);
  const legacy = read === null ? READ_MISSING_LEGACY_RE.exec(message) : null;
  if (read !== null || legacy !== null) {
    const missingBase = read !== null ? read[1] : legacy?.[2];
    const key = (read !== null ? read[2] : legacy?.[1]) ?? '';
    const candidates = (readsOf?.(expr) ?? []).filter((r) => r.key === key);
    const only = candidates.length === 1 ? candidates[0] : undefined;
    return withAt({
      reason: 'EXPR_READ_MISSING',
      params: {
        ...base,
        expr,
        key,
        base: missingBase === 'null' ? 'null' : 'undefined',
        ...(only !== undefined && { chain: only.chain }),
        ...(only?.source !== undefined && { source: only.source }),
      },
    });
  }
  const name = NAME_UNKNOWN_RE.exec(message);
  if (name !== null) {
    return withAt({
      reason: 'EXPR_NAME_UNKNOWN',
      params: { ...base, name: name[1] ?? '' },
    });
  }
  const notFunction = NOT_FUNCTION_RE.exec(message);
  if (notFunction !== null) {
    return withAt({
      reason: 'EXPR_NOT_FUNCTION',
      params: { ...base, callee: cutText(notFunction[1] ?? '', 80) },
    });
  }
  if (SYNTAX_RE.test(message)) {
    return withAt({
      reason: 'EXPR_SYNTAX',
      params: { ...base, detail: message },
    });
  }
  const errorName = ERROR_NAME_RE.exec(message)?.[1];
  return withAt({
    reason: 'EXPR_FAILED',
    params: {
      ...base,
      expr,
      ...(errorName !== undefined && { errorName }),
      detail: message,
    },
  });
}

/** The field a pointer names, as an author reads it: `/nodes/3/input/query`
 * → `input.query`, `/output/total` → `output.total`. */
export function fieldOf(pointer: string): string {
  const tokens = pointer
    .split('/')
    .slice(1)
    .map((t) => t.replaceAll('~1', '/').replaceAll('~0', '~'));
  const rest = tokens[0] === 'nodes' ? tokens.slice(2) : tokens;
  return rest.join('.');
}
