import type { Sql } from 'postgres';

import type {
  ModerationErrorClass,
  ModerationExtras,
  ModerationOutcome,
  ModerationRun,
} from '../../../lib/chat/guardrails.ts';
import { safeFetch, SafeFetchError } from '../../../lib/net/safe-fetch.ts';
import type { GuardrailsDirection } from '../../../lib/pii/core/outcome.ts';
import type {
  ModerationProviderConfig,
  ModerationResponseShape,
} from '../../../lib/shared/schemas/governance.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  MODERATION_SECRET_NAME,
  readGovernanceSecret,
} from './settings-tail.ts';

/**
 * The external moderation provider — the `ModerationBackend` port of the
 * chat guardrail chain (`lib/chat/guardrails.ts`), implemented here in the
 * governance domain: the HTTP call, its request template and secret, the
 * per-provider response mapping, and the circuit breaker. The chain decides
 * WHEN it runs and what a verdict means; this module only answers "what did
 * the provider say about this text".
 *
 * Never throws for a provider fault: every failure class comes back as a
 * `step_error` outcome and the chain applies the policy's fail behaviour.
 * Nothing here logs headers, bodies, or the text under review — only the
 * status / class / timing facts the chat-filter event carries.
 */

// ------------------------------------------------------------ circuit breaker

interface CircuitState {
  failures: number[];
  openedAt: number | null;
}

const CIRCUIT_FAILURE_THRESHOLD = 10;
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 60_000;

/** Per-process breaker keyed by `${orgId}:${direction}` — ephemeral, and it
 * self-heals on cooldown. A replica sees only its own failures, so the
 * threshold is per replica; that is the accepted posture. */
const circuits = new Map<string, CircuitState>();

function circuitKey(organizationId: string, direction: string): string {
  return `${organizationId}:${direction}`;
}

export function isCircuitOpen(
  organizationId: string,
  direction: string,
): boolean {
  const state = circuits.get(circuitKey(organizationId, direction));
  if (!state || state.openedAt === null) return false;
  if (Date.now() - state.openedAt >= CIRCUIT_COOLDOWN_MS) {
    state.openedAt = null;
    state.failures = [];
    return false;
  }
  return true;
}

function recordCircuitFailure(
  organizationId: string,
  direction: string,
): { justOpened: boolean } {
  const key = circuitKey(organizationId, direction);
  let state = circuits.get(key);
  if (!state) {
    state = { failures: [], openedAt: null };
    circuits.set(key, state);
  }
  const now = Date.now();
  state.failures = [
    ...state.failures.filter((at) => now - at < CIRCUIT_WINDOW_MS),
    now,
  ];
  const wasOpen = state.openedAt !== null;
  if (state.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openedAt = now;
  }
  return { justOpened: !wasOpen && state.openedAt !== null };
}

function recordCircuitSuccess(organizationId: string, direction: string): void {
  const state = circuits.get(circuitKey(organizationId, direction));
  if (!state) return;
  state.failures = [];
  state.openedAt = null;
}

/** Test hook: forget every breaker. */
export function resetModerationCircuitsForTesting(): void {
  circuits.clear();
}

// ------------------------------------------------------------- the request

/**
 * JSON-safe substitution of the `{{text}}` / `{{direction}}` placeholders:
 * the template is parsed as JSON with sentinel strings in place, the tree
 * is walked, and the sentinels are replaced in string leaves — so a message
 * containing quotes or newlines can never break the request body.
 */
export function substituteModerationTemplate(
  template: string,
  text: string,
  direction: GuardrailsDirection,
): string {
  const placeholderText = ' GUARDRAILS_TEXT ';
  const placeholderDir = ' GUARDRAILS_DIRECTION ';
  const rendered = template
    .replace(/\{\{text\}\}/g, JSON.stringify(placeholderText))
    .replace(/\{\{direction\}\}/g, JSON.stringify(placeholderDir));
  const parsed: unknown = JSON.parse(rendered);
  const replacer = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(placeholderText, text)
        .replace(placeholderDir, direction);
    }
    if (Array.isArray(value)) return value.map(replacer);
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        out[key] = replacer(entry);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(replacer(parsed));
}

/** Splice the one stored auth header into every header value that names
 * `{{secret}}`; a template that needs it with nothing stored is a config
 * fault, not a request. */
export function applyModerationSecret(
  headers: Record<string, string>,
  authHeader: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value.includes('{{secret}}')) {
      if (authHeader === null) {
        throw new Error(
          `Header "${key}" references {{secret}} but no moderation auth header is stored`,
        );
      }
      out[key] = value.replace(/\{\{secret\}\}/g, authHeader);
    } else {
      out[key] = value;
    }
  }
  return out;
}

class ModerationHttpError extends Error {
  readonly errorClass: ModerationErrorClass;
  readonly httpStatus: number | undefined;
  readonly durationMs: number;
  readonly attempts: number;

  constructor(
    errorClass: ModerationErrorClass,
    message: string,
    durationMs: number,
    attempts: number,
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'ModerationHttpError';
    this.errorClass = errorClass;
    this.httpStatus = httpStatus;
    this.durationMs = durationMs;
    this.attempts = attempts;
  }
}

function classifySafeFetchError(error: SafeFetchError): ModerationErrorClass {
  switch (error.kind) {
    case 'timeout':
      return 'timeout';
    case 'network_error':
    case 'redirect_missing_location':
    case 'redirect_limit_exceeded':
      return 'network';
    case 'invalid_url':
    case 'unsupported_protocol':
    case 'insecure_public_http':
    case 'private_ip':
      return 'config';
    case 'response_too_large':
    case 'response_too_small':
      return error.status !== undefined && error.status >= 500
        ? 'http_5xx'
        : 'http_4xx';
    default:
      return 'unknown';
  }
}

function isRetryable(
  errorClass: ModerationErrorClass,
  status: number | undefined,
): boolean {
  return (
    errorClass === 'http_5xx' ||
    errorClass === 'timeout' ||
    errorClass === 'network' ||
    status === 429
  );
}

const RETRY_JITTER_MS = 250;
const MAX_ATTEMPTS = 2;

function sleepJitter(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * RETRY_JITTER_MS)),
  );
}

interface CallResult {
  body: unknown;
  status: number;
  durationMs: number;
  attempts: number;
}

/** One provider call with one retry on a retryable failure (5xx / 429 /
 * network / timeout). Throws `ModerationHttpError` carrying only the audit
 * facts — never the request or the response. */
async function callModeration(input: {
  endpoint: ModerationProviderConfig['endpoint'];
  text: string;
  direction: GuardrailsDirection;
  authHeader: string | null;
}): Promise<CallResult> {
  const { endpoint, text, direction, authHeader } = input;
  const started = Date.now();

  let body: string;
  try {
    body = substituteModerationTemplate(
      endpoint.requestTemplate,
      text,
      direction,
    );
  } catch (error) {
    throw new ModerationHttpError(
      'config',
      `Invalid request template: ${error instanceof Error ? error.message : 'unknown'}`,
      Date.now() - started,
      0,
    );
  }
  let headers: Record<string, string>;
  try {
    headers = applyModerationSecret(endpoint.headers, authHeader);
    if (!('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }
  } catch (error) {
    throw new ModerationHttpError(
      'config',
      error instanceof Error ? error.message : 'Header resolution failed',
      Date.now() - started,
      0,
    );
  }

  let attempt = 0;
  let lastClass: ModerationErrorClass = 'unknown';
  let lastStatus: number | undefined;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      const response = await safeFetch(endpoint.url, {
        method: 'POST',
        headers,
        body,
        timeoutMs: endpoint.timeoutMs,
        maxResponseBytes: endpoint.maxResponseBytes,
        // No explicit allowedHosts: safeFetch auto-derives the initial host,
        // so a redirect to a different host still fails.
      });
      if (response.status >= 400) {
        const errorClass: ModerationErrorClass =
          response.status >= 500 ? 'http_5xx' : 'http_4xx';
        if (
          isRetryable(errorClass, response.status) &&
          attempt < MAX_ATTEMPTS
        ) {
          lastClass = errorClass;
          lastStatus = response.status;
          await sleepJitter();
          continue;
        }
        throw new ModerationHttpError(
          errorClass,
          `Upstream HTTP ${response.status}`,
          Date.now() - started,
          attempt,
          response.status,
        );
      }
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(response.body);
      } catch (error) {
        throw new ModerationHttpError(
          'parse',
          `Invalid JSON response: ${error instanceof Error ? error.message : 'unknown'}`,
          Date.now() - started,
          attempt,
          response.status,
        );
      }
      return {
        body: parsedBody,
        status: response.status,
        durationMs: Date.now() - started,
        attempts: attempt,
      };
    } catch (error) {
      if (error instanceof ModerationHttpError) throw error;
      if (error instanceof SafeFetchError) {
        const errorClass = classifySafeFetchError(error);
        if (isRetryable(errorClass, error.status) && attempt < MAX_ATTEMPTS) {
          lastClass = errorClass;
          lastStatus = error.status;
          await sleepJitter();
          continue;
        }
        throw new ModerationHttpError(
          errorClass,
          error.message,
          Date.now() - started,
          attempt,
          error.status,
        );
      }
      throw new ModerationHttpError(
        'unknown',
        error instanceof Error ? error.message : 'Unknown error',
        Date.now() - started,
        attempt,
      );
    }
  }
  throw new ModerationHttpError(
    lastClass,
    `Exhausted ${MAX_ATTEMPTS} attempts`,
    Date.now() - started,
    attempt,
    lastStatus,
  );
}

// ------------------------------------------------------------ the response

export interface NormalizedModerationResult {
  flagged: boolean;
  categories: Record<string, { flagged: boolean; score?: number }>;
}

export class ModerationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModerationParseError';
  }
}

/** Minimal JSONPath: `$.a.b[0].c` — the built-in shapes need no more. */
function readPath(root: unknown, jsonPath: string): unknown {
  if (!jsonPath.startsWith('$')) {
    throw new ModerationParseError(`JSONPath must start with $: ${jsonPath}`);
  }
  const tokens = jsonPath
    .slice(1)
    .split(/\.|\[(\d+)\]/)
    .filter((token) => token !== undefined && token !== '');
  let current: unknown = root;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    const index = Number(token);
    if (!Number.isNaN(index) && Array.isArray(current)) {
      current = current[index];
      continue;
    }
    if (isRecord(current)) {
      current = current[token];
      continue;
    }
    return undefined;
  }
  return current;
}

/** OpenAI Moderation: `results[0].flagged` + `categories` (bools) +
 * `category_scores` (numbers). */
function parseOpenAi(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ModerationParseError('Non-object response');
  const results = raw['results'];
  if (!Array.isArray(results) || results.length === 0) {
    throw new ModerationParseError('Missing results[]');
  }
  const first: unknown = results[0];
  if (!isRecord(first)) {
    throw new ModerationParseError('results[0] is not an object');
  }
  const flagged = first['flagged'] === true;
  const categoriesRaw = first['categories'];
  const scoresRaw = first['category_scores'];
  const categories: NormalizedModerationResult['categories'] = {};
  if (isRecord(categoriesRaw)) {
    for (const [key, value] of Object.entries(categoriesRaw)) {
      if (typeof value !== 'boolean') continue;
      const score = isRecord(scoresRaw) ? scoresRaw[key] : undefined;
      categories[key] =
        typeof score === 'number'
          ? { flagged: value, score }
          : { flagged: value };
    }
  }
  return { flagged, categories };
}

/** Azure AI Content Safety: `categoriesAnalysis: [{category, severity}]`,
 * severity 0..6 normalized to 0..1; any positive severity flags. */
function parseAzureContentSafety(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ModerationParseError('Non-object response');
  const analysis = raw['categoriesAnalysis'];
  if (!Array.isArray(analysis)) {
    throw new ModerationParseError('Missing categoriesAnalysis[]');
  }
  const categories: NormalizedModerationResult['categories'] = {};
  let anyFlagged = false;
  for (const entry of analysis as unknown[]) {
    if (!isRecord(entry)) continue;
    const category = entry['category'];
    const severity = entry['severity'];
    if (typeof category !== 'string' || typeof severity !== 'number') continue;
    const flagged = severity > 0;
    if (flagged) anyFlagged = true;
    categories[category] = {
      flagged,
      score: Math.min(1, Math.max(0, severity / 6)),
    };
  }
  return { flagged: anyFlagged, categories };
}

/** Perspective API: `attributeScores.<ATTR>.summaryScore.value` (0..1); a
 * category flags when its score is positive — the mapping's threshold
 * decides enforcement. */
function parsePerspective(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ModerationParseError('Non-object response');
  const attrs = raw['attributeScores'];
  if (!isRecord(attrs))
    throw new ModerationParseError('Missing attributeScores');
  const categories: NormalizedModerationResult['categories'] = {};
  let anyFlagged = false;
  for (const [attr, detail] of Object.entries(attrs)) {
    if (!isRecord(detail)) continue;
    const summary = detail['summaryScore'];
    if (!isRecord(summary)) continue;
    const score = summary['value'];
    if (typeof score !== 'number') continue;
    const flagged = score > 0;
    if (flagged) anyFlagged = true;
    categories[attr] = { flagged, score };
  }
  return { flagged: anyFlagged, categories };
}

function parseCustomJsonPath(
  raw: unknown,
  shape: Extract<ModerationResponseShape, { type: 'custom_jsonpath' }>,
): NormalizedModerationResult {
  const flaggedValue =
    shape.flaggedPath !== undefined ? readPath(raw, shape.flaggedPath) : null;
  const categoriesValue = readPath(raw, shape.categoriesPath);
  const scoresValue =
    shape.scoresPath !== undefined ? readPath(raw, shape.scoresPath) : null;
  const categories: NormalizedModerationResult['categories'] = {};

  if (shape.categoryShape === 'array') {
    if (!Array.isArray(categoriesValue)) {
      throw new ModerationParseError(
        'categoriesPath did not resolve to an array',
      );
    }
    for (const item of categoriesValue as unknown[]) {
      if (typeof item === 'string') categories[item] = { flagged: true };
    }
  } else if (shape.categoryShape === 'record_of_bool') {
    if (!isRecord(categoriesValue)) {
      throw new ModerationParseError(
        'categoriesPath did not resolve to an object (record_of_bool)',
      );
    }
    for (const [key, value] of Object.entries(categoriesValue)) {
      if (typeof value === 'boolean') categories[key] = { flagged: value };
    }
  } else {
    if (!isRecord(categoriesValue)) {
      throw new ModerationParseError(
        'categoriesPath did not resolve to an object (record_of_score)',
      );
    }
    for (const [key, value] of Object.entries(categoriesValue)) {
      if (typeof value === 'number') {
        categories[key] = { flagged: value > 0, score: value };
      }
    }
  }
  if (isRecord(scoresValue)) {
    for (const [key, value] of Object.entries(scoresValue)) {
      if (typeof value !== 'number') continue;
      const existing = categories[key];
      if (existing) existing.score = value;
      else categories[key] = { flagged: value > 0, score: value };
    }
  }
  const flagged =
    typeof flaggedValue === 'boolean'
      ? flaggedValue
      : Object.values(categories).some((category) => category.flagged);
  return { flagged, categories };
}

export function parseModerationResponse(
  raw: unknown,
  shape: ModerationResponseShape,
): NormalizedModerationResult {
  switch (shape.type) {
    case 'openai_moderation':
      return parseOpenAi(raw);
    case 'azure_content_safety':
      return parseAzureContentSafety(raw);
    case 'perspective':
      return parsePerspective(raw);
    case 'custom_jsonpath':
      return parseCustomJsonPath(raw, shape);
    default: {
      const exhaustive: never = shape;
      throw new ModerationParseError(
        `Unknown response shape: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** Apply the admin's category → action mapping to what the provider
 * flagged: a mapping with a threshold reads the score, one without reads
 * the provider's own flag. */
export function resolveModerationMappings(
  categories: NormalizedModerationResult['categories'],
  mappings: ModerationProviderConfig['categoryMappings'],
): { block: string[]; mask: string[]; flag: string[] } {
  const block: string[] = [];
  const mask: string[] = [];
  const flag: string[] = [];
  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    const result = categories[mapping.providerCategory];
    if (!result) continue;
    const triggered =
      mapping.scoreThreshold === undefined
        ? result.flagged
        : result.score !== undefined && result.score >= mapping.scoreThreshold;
    if (!triggered) continue;
    if (mapping.mode === 'block') block.push(mapping.internalLabel);
    else if (mapping.mode === 'mask') mask.push(mapping.internalLabel);
    else flag.push(mapping.internalLabel);
  }
  return { block, mask, flag };
}

// ---------------------------------------------------------------- the run

export interface RunModerationArgs {
  readonly organizationId: string;
  readonly direction: GuardrailsDirection;
  readonly text: string;
  readonly config: ModerationProviderConfig;
}

/**
 * One round through the configured provider. Reads the stored auth header,
 * respects the breaker, classifies every failure, and maps the provider's
 * categories through the admin's mapping.
 */
export async function runModerationProvider(
  sql: Sql,
  args: RunModerationArgs,
): Promise<ModerationRun> {
  const { organizationId, direction, text, config } = args;
  const stepError = (extras: ModerationExtras): ModerationRun => ({
    outcome: {
      kind: 'step_error',
      filterName: 'moderation_provider',
      reason: extras.errorClass ?? 'unknown',
    },
    extras,
  });
  const failed = (extras: ModerationExtras): ModerationRun =>
    stepError({
      ...extras,
      circuitOpened: recordCircuitFailure(organizationId, direction).justOpened,
    });

  if (isCircuitOpen(organizationId, direction)) {
    return stepError({ errorClass: 'unknown', circuitOpen: true });
  }

  const requiresSecret = Object.values(config.endpoint.headers).some((value) =>
    value.includes('{{secret}}'),
  );
  const authHeader = requiresSecret
    ? await readGovernanceSecret(sql, organizationId, MODERATION_SECRET_NAME)
    : null;
  if (requiresSecret && authHeader === null) {
    return failed({ errorClass: 'config' });
  }

  let call: CallResult;
  try {
    call = await callModeration({
      endpoint: config.endpoint,
      text,
      direction,
      authHeader,
    });
  } catch (error) {
    if (error instanceof ModerationHttpError) {
      return failed({
        errorClass: error.errorClass,
        ...(error.httpStatus !== undefined
          ? { httpStatus: error.httpStatus }
          : {}),
        durationMs: error.durationMs,
        attempts: error.attempts,
      });
    }
    console.warn(
      `[moderation] provider call failed for org ${organizationId}: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return failed({ errorClass: 'unknown' });
  }

  let normalized: NormalizedModerationResult;
  try {
    normalized = parseModerationResponse(call.body, config.responseShape);
  } catch (error) {
    if (!(error instanceof ModerationParseError)) throw error;
    return failed({
      errorClass: 'parse',
      httpStatus: call.status,
      durationMs: call.durationMs,
      attempts: call.attempts,
    });
  }
  recordCircuitSuccess(organizationId, direction);

  const { block, mask, flag } = resolveModerationMappings(
    normalized.categories,
    config.categoryMappings,
  );
  const extras: ModerationExtras = {
    httpStatus: call.status,
    durationMs: call.durationMs,
    attempts: call.attempts,
  };
  const matchCount = block.length + mask.length + flag.length;
  if (block.length > 0) {
    return {
      outcome: { kind: 'blocked', categoryIds: block, matchCount },
      extras,
    };
  }
  if (matchCount > 0) {
    return {
      outcome: { kind: 'flagged', categoryIds: [...mask, ...flag], matchCount },
      extras,
    };
  }
  return { outcome: { kind: 'pass' }, extras };
}

// ------------------------------------------------------- the settings probe

/** What the settings page's "Test connection" renders — the outcome
 * vocabulary of the pipeline plus the round's audit facts, never a raw
 * provider body or the decrypted header. */
export interface ModerationTestResult {
  ok: boolean;
  kind: ModerationOutcome['kind'] | 'not_configured';
  categoryIds?: string[];
  matchCount?: number;
  httpStatus?: number;
  durationMs?: number;
  errorClass?: ModerationErrorClass;
  circuitOpened?: boolean;
  hint?: string;
}

/**
 * The admin's round trip through the REAL provider path — the same call the
 * chat turn makes, so a bad URL, key, template, or JSONPath shows up at
 * configuration time with the error class the events page would report.
 */
export async function testModerationProvider(
  sql: Sql,
  organizationId: string,
  args: { text: string; direction?: GuardrailsDirection },
): Promise<ModerationTestResult> {
  const config = await readGovernancePolicyForOrg(
    sql,
    organizationId,
    'moderation_provider',
  );
  if (config === null || !config.enabled) {
    return {
      ok: false,
      kind: 'not_configured',
      hint:
        config === null
          ? 'No moderation provider is configured for this organization.'
          : 'The moderation provider is disabled — enable it and save before testing.',
    };
  }
  const run = await runModerationProvider(sql, {
    organizationId,
    direction: args.direction ?? 'input',
    text: args.text,
    config,
  });
  const extras = {
    ...(run.extras.httpStatus !== undefined
      ? { httpStatus: run.extras.httpStatus }
      : {}),
    ...(run.extras.durationMs !== undefined
      ? { durationMs: run.extras.durationMs }
      : {}),
    ...(run.extras.circuitOpened !== undefined
      ? { circuitOpened: run.extras.circuitOpened }
      : {}),
  };
  switch (run.outcome.kind) {
    case 'pass':
      return { ok: true, kind: 'pass', ...extras };
    case 'flagged':
    case 'blocked':
      return {
        ok: true,
        kind: run.outcome.kind,
        categoryIds: run.outcome.categoryIds,
        matchCount: run.outcome.matchCount,
        ...extras,
      };
    case 'step_error':
      return {
        ok: false,
        kind: 'step_error',
        errorClass: run.outcome.reason,
        ...extras,
        ...(run.extras.circuitOpen === true
          ? {
              hint: 'The provider circuit is open after repeated failures — it closes again after a minute.',
            }
          : {}),
      };
    default: {
      const exhaustive: never = run.outcome;
      throw new Error(`Unhandled outcome ${JSON.stringify(exhaustive)}`);
    }
  }
}
