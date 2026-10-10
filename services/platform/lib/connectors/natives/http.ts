/**
 * The HTTP connector's native backend: `http.get` reads from and `http.send`
 * writes to any HTTPS API on an automation's behalf, with or without a stored
 * credential.
 *
 * Keeping that safe is this module's whole job:
 *
 *  - Every request goes through `safeFetch`, the platform's audited outbound
 *    client: DNS is pinned for each hop, private and cloud metadata addresses
 *    are refused, and the answer is capped. The switch that admits private
 *    model-provider hosts does not reach here: an automation author is not
 *    the operator who configured a provider.
 *  - Every call is HTTPS, and an `https:` start never follows a redirect onto
 *    `http:`. Plain `http:` reaches only a private host a host of this module
 *    admits (`privateHostsAllowed`), which the platform's does not.
 *  - A credentialed call stays under its credential's base URL: a path is
 *    placed under it, a full URL must start with it, a redirect may not leave
 *    its host, and the address a redirect chain ended on is checked the same
 *    way before its answer is handed back.
 *  - `Authorization`, `Cookie`, `Proxy-Authorization` and the API key header
 *    never come from the step: the credential signs the request.
 *  - The answer keeps an allowlist of headers, and the credential's own
 *    values are scrubbed from everything handed back, so no record, trace or
 *    failure carries them.
 *  - Each organization has a lane: a budget of calls a minute across the
 *    deployment, and a number of calls at once in this process.
 *
 * Every refusal names its cause in the run record's words (`failure`), so a
 * run says why the step failed in the reader's language.
 */

import { isMetadataAddress, isPrivateIp } from '@tale/shared/net/private-ip';

import type { FailureCause } from '../../engine/core/record/failure';
import { BLOCKED_METADATA_HOSTS } from '../../net/host-policy';
import {
  safeFetch,
  SafeFetchError,
  type SafeFetchOptions,
  type SafeFetchResponse,
} from '../../net/safe-fetch';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError, type ConnectorErrorCode } from '../errors';

/** How long a call waits for its whole answer unless the step says. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** The largest answer a step reads; a larger one is refused. */
const HTTP_MAX_RESPONSE_BYTES = 1_048_576;

/** Redirects a call follows before it gives up. */
const MAX_REDIRECTS = 5;

/** Calls an organization's automations may make in a minute, across the
 * deployment, and at once, in one server process. */
const HTTP_CALLS_PER_MINUTE = 120;
const HTTP_CALLS_AT_ONCE = 10;

/** Headers only a credential sets. */
const RESERVED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
]);

/** The answer headers a step reads; every other one is dropped. */
const ANSWER_HEADERS = new Set([
  'content-type',
  'etag',
  'last-modified',
  'location',
  'link',
  'retry-after',
]);
const ANSWER_HEADER_PREFIXES = ['x-ratelimit-'];

/** A credential value shorter than this is not scrubbed from answers: it
 * would match ordinary text. Tokens and passwords are longer. */
const MIN_SCRUBBED_LENGTH = 6;
const SCRUBBED = '[redacted]';

/** A header name as RFC 9110 allows it. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

type HttpAction = 'get' | 'send';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface HttpInput {
  readonly url: string;
  readonly query: Readonly<Record<string, string | number | boolean>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly responseType?: 'json' | 'text';
  readonly okStatuses: readonly number[];
  readonly method: HttpMethod;
  readonly body?: unknown;
  readonly contentType?: string;
}

/** What a step reads back. */
export interface HttpAnswer {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** How a credential signs a request, and the values it must never leak. */
interface Signing {
  readonly header: readonly [name: string, value: string];
  /** A step header that would stand in for the credential's own. */
  readonly reserved: string;
  readonly secrets: readonly string[];
}

/** The deployment-wide budget of calls a minute. */
export interface HttpCallBudget {
  /** Charge one call to the organization's budget; `false` when spent. */
  charge(organizationId: string): Promise<boolean>;
}

export interface HttpNativeDeps {
  readonly budget?: HttpCallBudget;
  /** The outbound client: `safeFetch` unless a test hands another. */
  readonly fetch?: (
    url: string,
    options: SafeFetchOptions,
  ) => Promise<SafeFetchResponse>;
  /** Whether a call may reach a private network address. No by default,
   * and the platform's host keeps it so. */
  readonly privateHostsAllowed?: () => boolean;
  /** The calls-at-once gate; one per process unless a test hands another. */
  readonly atOnce?: AtOnceGate;
}

/**
 * Calls in flight per organization in this process. A call over the limit
 * waits for a slot as long as its own timeout allows, then gives up.
 */
export class AtOnceGate {
  private readonly running = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number) {}

  /** A release for the slot taken, or undefined when none freed in time. */
  enter(key: string, waitMs: number): Promise<(() => void) | undefined> {
    if ((this.running.get(key) ?? 0) < this.limit) {
      this.take(key);
      return Promise.resolve(() => this.leave(key));
    }
    return new Promise((resolve) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.take(key);
        resolve(() => this.leave(key));
      };
      const timer = setTimeout(() => {
        const queue = this.waiting.get(key) ?? [];
        const at = queue.indexOf(wake);
        if (at >= 0) queue.splice(at, 1);
        if (queue.length === 0) this.waiting.delete(key);
        resolve(undefined);
      }, waitMs);
      const queue = this.waiting.get(key) ?? [];
      queue.push(wake);
      this.waiting.set(key, queue);
    });
  }

  private take(key: string): void {
    this.running.set(key, (this.running.get(key) ?? 0) + 1);
  }

  private leave(key: string): void {
    const left = (this.running.get(key) ?? 1) - 1;
    if (left <= 0) this.running.delete(key);
    else this.running.set(key, left);
    const queue = this.waiting.get(key);
    const next = queue?.shift();
    if (queue !== undefined && queue.length === 0) this.waiting.delete(key);
    next?.();
  }
}

/** The gate every registration of this module shares in one process. */
const PROCESS_GATE = new AtOnceGate(HTTP_CALLS_AT_ONCE);

/** A refusal with its cause in the run record's words. */
class HttpRefusal extends ConnectorError {
  readonly failure: FailureCause;

  constructor(
    code: ConnectorErrorCode,
    message: string,
    action: HttpAction,
    failure: FailureCause,
    hint?: string,
  ) {
    super(code, message, {
      connector: 'http',
      action,
      ...(hint !== undefined && { hint }),
    });
    this.failure = failure;
  }
}

function refusal(
  action: HttpAction,
  code: ConnectorErrorCode,
  message: string,
  failure: FailureCause,
): HttpRefusal {
  return new HttpRefusal(code, message, action, failure);
}

const urlInvalid = (
  action: HttpAction,
  why: 'url' | 'scheme' | 'userinfo' | 'path' | 'base',
  message: string,
): HttpRefusal =>
  refusal(action, 'INVALID_URL', message, {
    reason: 'HTTP_URL_INVALID',
    params: { why },
  });

/** Lower case, unbracketed, no trailing dot: `metadata.google.internal.`
 * and `[::1]` must not slip past a comparison. */
function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

/** An address as a failure may show it: no query, no fragment. */
function shown(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The step's input, as the action's schema already checked it. */
function readInput(raw: unknown, action: HttpAction): HttpInput {
  if (!isRecord(raw) || typeof raw.url !== 'string') {
    throw new ConnectorError('INPUT_INVALID', 'an HTTP step needs a url', {
      connector: 'http',
      action,
    });
  }
  const query: Record<string, string | number | boolean> = {};
  if (isRecord(raw.query)) {
    for (const [name, value] of Object.entries(raw.query)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        query[name] = value;
      }
    }
  }
  const headers: Record<string, string> = {};
  if (isRecord(raw.headers)) {
    for (const [name, value] of Object.entries(raw.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }
  }
  const method =
    action === 'get'
      ? 'GET'
      : raw.method === 'POST' ||
          raw.method === 'PUT' ||
          raw.method === 'PATCH' ||
          raw.method === 'DELETE'
        ? raw.method
        : undefined;
  if (method === undefined) {
    throw new ConnectorError(
      'INPUT_INVALID',
      'an HTTP send needs a method: POST, PUT, PATCH or DELETE',
      { connector: 'http', action },
    );
  }
  return {
    url: raw.url,
    query,
    headers,
    timeoutMs:
      typeof raw.timeoutMs === 'number' ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
    ...(raw.responseType === 'json' || raw.responseType === 'text'
      ? { responseType: raw.responseType }
      : {}),
    okStatuses: Array.isArray(raw.okStatuses)
      ? raw.okStatuses.filter((s): s is number => typeof s === 'number')
      : [],
    method,
    ...(action === 'send' && raw.body !== undefined ? { body: raw.body } : {}),
    ...(typeof raw.contentType === 'string'
      ? { contentType: raw.contentType }
      : {}),
  };
}

/** How the step's credential signs, or undefined for a call without one. */
function signingOf(
  ctx: NativeConnectorContext,
  action: HttpAction,
): Signing | undefined {
  const unusable = (message: string): ConnectorError =>
    new ConnectorError('CREDENTIAL_UNRESOLVED', message, {
      connector: 'http',
      action,
      hint: 'check the credential in Settings → Connectors',
    });
  switch (ctx.authMethod) {
    case 'none':
      return undefined;
    case 'bearer': {
      const token = ctx.secrets.get('token');
      if (token === '') throw unusable('the HTTP credential holds no token');
      return {
        header: ['Authorization', `Bearer ${token}`],
        reserved: 'authorization',
        secrets: [token],
      };
    }
    case 'basic': {
      const username = ctx.secrets.get('username');
      const password = ctx.secrets.get('password');
      if (username === '') {
        throw unusable('the HTTP credential holds no user name');
      }
      const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString(
        'base64',
      );
      return {
        header: ['Authorization', `Basic ${encoded}`],
        reserved: 'authorization',
        secrets: [password, encoded],
      };
    }
    case 'api-key': {
      const token = ctx.secrets.get('token');
      if (token === '') throw unusable('the HTTP credential holds no API key');
      const configured = ctx.config.apiKeyHeader;
      const name =
        typeof configured === 'string' && configured.trim() !== ''
          ? configured.trim()
          : 'X-Api-Key';
      if (!HEADER_NAME_RE.test(name)) {
        throw unusable(
          `the HTTP credential's API key header "${name}" is not a header name`,
        );
      }
      return {
        header: [name, token],
        reserved: name.toLowerCase(),
        secrets: [token],
      };
    }
    default:
      throw unusable(
        `the HTTP connector cannot sign with a ${ctx.authMethod} credential`,
      );
  }
}

/** The credential's base URL: every call with it stays under it. */
function baseOf(ctx: NativeConnectorContext, action: HttpAction): URL {
  const raw = ctx.config.baseUrl;
  const invalid = () =>
    urlInvalid(
      action,
      'base',
      "the HTTP credential's base URL is not an address",
    );
  if (typeof raw !== 'string' || raw.trim() === '') throw invalid();
  let base: URL;
  try {
    base = new URL(raw.trim());
  } catch {
    throw invalid();
  }
  if (
    (base.protocol !== 'https:' && base.protocol !== 'http:') ||
    base.username !== '' ||
    base.password !== '' ||
    base.search !== '' ||
    base.hash !== ''
  ) {
    throw invalid();
  }
  return base;
}

/** Whether `url` lies under `base`: the same scheme, host and port, and a
 * path at or below the base's path. */
function underBase(url: URL, base: URL): boolean {
  if (url.protocol !== base.protocol || url.host !== base.host) return false;
  const prefix = base.pathname.replace(/\/+$/, '');
  return (
    prefix === '' ||
    url.pathname === prefix ||
    url.pathname.startsWith(`${prefix}/`)
  );
}

function offOrigin(action: HttpAction, target: string, base: URL): HttpRefusal {
  return refusal(
    action,
    'HOST_NOT_ALLOWED',
    `${target} is not under the credential's base URL ${shown(base)}`,
    {
      reason: 'HTTP_OFF_ORIGIN',
      params: { target, baseUrl: shown(base) },
    },
  );
}

/** The address the step calls, with its query. */
function targetOf(
  input: HttpInput,
  base: URL | undefined,
  action: HttpAction,
): URL {
  let url: URL;
  if (input.url.startsWith('/') && !input.url.startsWith('//')) {
    if (base === undefined) {
      throw urlInvalid(
        action,
        'path',
        'a path needs a credential whose base URL it belongs under',
      );
    }
    const prefix = base.pathname.replace(/\/+$/, '');
    try {
      url = new URL(`${base.origin}${prefix}${input.url}`);
    } catch {
      throw urlInvalid(action, 'url', 'the step URL is not an address');
    }
  } else {
    try {
      url = new URL(input.url);
    } catch {
      throw urlInvalid(action, 'url', 'the step URL is not an address');
    }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw urlInvalid(action, 'scheme', `the step URL uses ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw urlInvalid(
      action,
      'userinfo',
      'the step URL carries a user name or a password',
    );
  }
  // A path with `..` or an encoded one resolves before this check, so it
  // cannot climb out of the base.
  if (base !== undefined && !underBase(url, base)) {
    throw offOrigin(action, shown(url), base);
  }
  for (const [name, value] of Object.entries(input.query)) {
    url.searchParams.append(name, String(value));
  }
  return url;
}

/** Refuse what the deployment never lets an automation call. */
function refuseBlockedHost(
  url: URL,
  privateAllowed: boolean,
  action: HttpAction,
): void {
  const host = normalizeHost(url.hostname);
  const blocked = (
    why: 'private' | 'metadata' | 'plaintext',
    message: string,
  ): HttpRefusal =>
    refusal(
      action,
      why === 'plaintext' ? 'INSECURE_SCHEME' : 'BLOCKED_HOST',
      message,
      { reason: 'HTTP_BLOCKED_HOST', params: { host: url.host, why } },
    );
  if (BLOCKED_METADATA_HOSTS.has(host) || isMetadataAddress(host)) {
    throw blocked('metadata', `${host} is a cloud metadata address`);
  }
  const isPrivate = isPrivateIp(host);
  if (isPrivate && !privateAllowed) {
    throw blocked('private', `${host} is a private network address`);
  }
  if (url.protocol === 'http:' && !isPrivate) {
    throw blocked('plaintext', `${host} is a public host called over http:`);
  }
}

/** The step's headers and the credential's, refusing one only a credential
 * may set. */
function requestHeaders(
  input: HttpInput,
  signing: Signing | undefined,
  action: HttpAction,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    const lower = name.toLowerCase();
    if (RESERVED_HEADERS.has(lower) || lower === signing?.reserved) {
      throw refusal(
        action,
        'INPUT_INVALID',
        `the step sets the ${name} header, which only a credential sets`,
        { reason: 'HTTP_HEADER_RESERVED', params: { header: name } },
      );
    }
    if (!HEADER_NAME_RE.test(name) || /[\r\n\0]/.test(value)) {
      throw new ConnectorError(
        'INPUT_INVALID',
        `the step header "${name}" is not a header`,
        { connector: 'http', action },
      );
    }
    headers[name] = value;
  }
  if (signing !== undefined) {
    const [name, value] = signing.header;
    headers[name] = value;
  }
  return headers;
}

/** The request body and its type: a string as it is, any other value as
 * JSON. */
function requestBody(
  input: HttpInput,
  headers: Record<string, string>,
): string | undefined {
  if (input.body === undefined) return undefined;
  const typed = Object.keys(headers).some(
    (name) => name.toLowerCase() === 'content-type',
  );
  if (typeof input.body === 'string') {
    if (!typed) {
      headers['Content-Type'] =
        input.contentType ?? 'text/plain; charset=utf-8';
    }
    return input.body;
  }
  if (!typed) headers['Content-Type'] = 'application/json';
  return JSON.stringify(input.body);
}

/** Every credential value replaced, wherever an answer echoes it. */
function scrubber(secrets: readonly string[]): (text: string) => string {
  const values = secrets.filter((value) => value.length >= MIN_SCRUBBED_LENGTH);
  return (text) =>
    values.reduce((out, value) => out.split(value).join(SCRUBBED), text);
}

function isJsonType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return type === 'application/json' || type.endsWith('+json');
}

/** The cause of a request that never produced an answer. */
function failedRequest(
  error: unknown,
  action: HttpAction,
  method: HttpMethod,
  url: URL,
  timeoutMs: number,
  base: URL | undefined,
  scrub: (text: string) => string,
): unknown {
  if (!(error instanceof SafeFetchError)) return error;
  const host = url.host;
  switch (error.kind) {
    case 'invalid_url':
      return urlInvalid(action, 'url', 'the step URL is not an address');
    case 'unsupported_protocol':
      return urlInvalid(action, 'scheme', 'the step URL is not https');
    case 'insecure_public_http':
      return refusal(action, 'INSECURE_SCHEME', error.message, {
        reason: 'HTTP_BLOCKED_HOST',
        params: { host, why: 'plaintext' },
      });
    case 'private_ip':
      return refusal(action, 'BLOCKED_HOST', error.message, {
        reason: 'HTTP_BLOCKED_HOST',
        params: {
          host,
          why: /metadata/i.test(error.message) ? 'metadata' : 'private',
        },
      });
    case 'host_not_allowed': {
      // A redirect tried to leave the credential's host.
      const left = /:\s*(\S+)$/.exec(error.message)?.[1] ?? 'another host';
      return refusal(action, 'HOST_NOT_ALLOWED', error.message, {
        reason: 'HTTP_OFF_ORIGIN',
        params: { target: left, baseUrl: shown(base ?? url) },
      });
    }
    case 'response_too_large':
      return refusal(
        action,
        'RESPONSE_TOO_LARGE',
        `${host} sent an answer larger than ${HTTP_MAX_RESPONSE_BYTES} bytes`,
        { reason: 'HTTP_TOO_LARGE', params: { host } },
      );
    case 'timeout':
      return refusal(action, 'REQUEST_FAILED', error.message, {
        reason: 'HTTP_TIMEOUT',
        params: { method, host, limitMs: timeoutMs },
      });
    case 'aborted':
      return error;
    default:
      return refusal(action, 'REQUEST_FAILED', error.message, {
        reason: 'HTTP_UNREACHABLE',
        params: { host, detail: scrub(`${error.kind}: ${error.message}`) },
      });
  }
}

async function callApi(
  action: HttpAction,
  raw: unknown,
  ctx: NativeConnectorContext,
  deps: HttpNativeDeps,
): Promise<HttpAnswer> {
  const input = readInput(raw, action);
  const privateAllowed = deps.privateHostsAllowed?.() ?? false;
  const signing = signingOf(ctx, action);
  const base = signing === undefined ? undefined : baseOf(ctx, action);
  if (base !== undefined) refuseBlockedHost(base, privateAllowed, action);
  const target = targetOf(input, base, action);
  refuseBlockedHost(target, privateAllowed, action);
  const headers = requestHeaders(input, signing, action);
  const body = requestBody(input, headers);
  const scrub = scrubber(signing?.secrets ?? []);

  const rateLimited = (): HttpRefusal =>
    refusal(
      action,
      'REQUEST_FAILED',
      `the organization made more than ${HTTP_CALLS_PER_MINUTE} HTTP calls in a minute, or ${HTTP_CALLS_AT_ONCE} at once`,
      {
        reason: 'HTTP_RATE_LIMITED',
        params: {
          perMinute: HTTP_CALLS_PER_MINUTE,
          atOnce: HTTP_CALLS_AT_ONCE,
        },
      },
    );
  if (
    deps.budget !== undefined &&
    !(await deps.budget.charge(ctx.organizationId))
  ) {
    throw rateLimited();
  }
  const release = await (deps.atOnce ?? PROCESS_GATE).enter(
    ctx.organizationId,
    input.timeoutMs,
  );
  if (release === undefined) throw rateLimited();

  try {
    let response: SafeFetchResponse;
    try {
      response = await (deps.fetch ?? safeFetch)(target.href, {
        method: input.method,
        headers,
        ...(body !== undefined && { body }),
        timeoutMs: input.timeoutMs,
        maxResponseBytes: HTTP_MAX_RESPONSE_BYTES,
        maxRedirects: MAX_REDIRECTS,
        // An https start never follows a redirect onto plain http.
        httpsOnly: target.protocol === 'https:',
        allowPrivateAddresses: privateAllowed,
        // A credentialed call never leaves its base URL's host; one without
        // a credential may follow a redirect anywhere public.
        ...(base !== undefined
          ? { allowedHosts: [base.hostname] }
          : { credentialless: true }),
        // A redirect to another port of the same host drops the signing
        // header too, whatever its name.
        ...(signing !== undefined && {
          sensitiveHeaders: [signing.header[0]],
        }),
      });
    } catch (error) {
      throw failedRequest(
        error,
        action,
        input.method,
        target,
        input.timeoutMs,
        base,
        scrub,
      );
    }

    if (base !== undefined) {
      let landed: URL | undefined;
      try {
        landed = new URL(response.finalUrl);
      } catch {
        landed = undefined;
      }
      if (landed === undefined || !underBase(landed, base)) {
        throw offOrigin(
          action,
          landed === undefined ? response.finalUrl : shown(landed),
          base,
        );
      }
    }

    const answerHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (
        ANSWER_HEADERS.has(lower) ||
        ANSWER_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
      ) {
        answerHeaders[lower] = scrub(value);
      }
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    const text = scrub(response.body);
    const ok = response.status >= 200 && response.status < 300;
    if (!ok && !input.okStatuses.includes(response.status)) {
      throw refusal(
        action,
        'LIVE_BODY_FAILED',
        `${target.host} answered ${response.status} to the ${input.method} request`,
        {
          reason: 'HTTP_STATUS',
          params: {
            status: response.status,
            method: input.method,
            host: target.host,
            detail: text.slice(0, 300),
          },
        },
      );
    }

    let answerBody: unknown = text;
    const readJson =
      input.responseType === 'json' ||
      (input.responseType === undefined && isJsonType(contentType));
    if (text === '') {
      answerBody = null;
    } else if (readJson) {
      try {
        answerBody = JSON.parse(text);
      } catch {
        if (input.responseType === 'json') {
          throw refusal(
            action,
            'LIVE_BODY_FAILED',
            `${target.host} answered with a body that is not JSON`,
            {
              reason: 'HTTP_NOT_JSON',
              params: {
                host: target.host,
                ...(contentType !== undefined && { contentType }),
              },
            },
          );
        }
        answerBody = text;
      }
    }
    return {
      status: response.status,
      ok,
      headers: answerHeaders,
      body: answerBody,
    };
  } finally {
    release();
  }
}

/** The two actions, keyed by the impl ids the connector declares. */
export function httpNatives(
  deps: HttpNativeDeps = {},
): Record<'http.get' | 'http.send', NativeConnectorImpl> {
  return {
    'http.get': (input, ctx) => callApi('get', input, ctx, deps),
    'http.send': (input, ctx) => callApi('send', input, ctx, deps),
  };
}
