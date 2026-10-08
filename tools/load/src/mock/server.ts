/**
 * The mock provider's HTTP server: one `node:http` server that speaks the
 * OpenAI and Anthropic dialects side by side.
 *
 * Routes answer with or without the `/v1` prefix (and with it doubled), so
 * a connector's base URL may be `<url>`, `<url>/v1`, or an Anthropic base
 * the platform appends `/v1/messages` to. The server is tuned for many long
 * streams: keep-alive outlives any client pool's idle timeout, there is no
 * request timeout (a stall must stay silent, and a long answer must never be
 * cut), and every stream stops its timers the moment its client leaves.
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { countMessageTokens, handleMessages } from './anthropic.ts';
import {
  parseMockOptions,
  type MockOptions,
  type MockOptionsInput,
} from './config.ts';
import { MockContext } from './context.ts';
import { handleEmbeddings } from './embeddings.ts';
import {
  handleImageGeneration,
  handleModeration,
  handleSpeech,
  handleTranscription,
} from './extras.ts';
import { errorReply, type Dialect } from './faults.ts';
import {
  BodyTooLargeError,
  headerValue,
  readBody,
  sendBytes,
  sendJson,
} from './http.ts';
import { MockMetrics } from './metrics.ts';
import { findMockModel, listingEntry, modelsListing } from './models.ts';
import { handleChatCompletions } from './openai.ts';

/** Idle keep-alive connections live this long (beyond common pool idles). */
const KEEP_ALIVE_TIMEOUT_MS = 90_000;
/** Header deadline; above the keep-alive timeout, as Node advises. */
const HEADERS_TIMEOUT_MS = 95_000;

export interface MockServer {
  /** Base URL of the server, without `/v1`. */
  readonly url: string;
  readonly port: number;
  readonly options: MockOptions;
  readonly metrics: MockMetrics;
  /** Stop listening and drop every open connection (streams included). */
  close(): Promise<void>;
}

/** A path with any number of leading `/v1` segments removed. */
export function routeOf(rawUrl: string): string {
  const query = rawUrl.indexOf('?');
  let path = (query === -1 ? rawUrl : rawUrl.slice(0, query)).replace(
    /\/{2,}/g,
    '/',
  );
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path.startsWith('/api/v1/') || path === '/api/v1') path = path.slice(4);
  while (path === '/v1' || path.startsWith('/v1/')) {
    path = path.length === 3 ? '/' : path.slice(3);
  }
  return path;
}

/** The `route` label of a path: known routes by name, the rest bucketed. */
function routeLabel(path: string): string {
  switch (path) {
    case '/chat/completions':
    case '/messages':
    case '/messages/count_tokens':
    case '/embeddings':
    case '/models':
    case '/images/generations':
    case '/audio/speech':
    case '/audio/transcriptions':
    case '/moderations':
      return `/v1${path}`;
    case '/health':
    case '/metrics':
      return path;
    default:
      return path.startsWith('/models/') ? '/v1/models/{id}' : 'not_found';
  }
}

function dialectOf(path: string): Dialect {
  return path.startsWith('/messages') ? 'anthropic' : 'openai';
}

/**
 * Whether the request carries a credential, as the dialect's provider
 * demands: a bearer token for OpenAI routes; `x-api-key` (or a bearer, as
 * Anthropic accepts for OAuth) for Anthropic routes.
 */
function authenticated(req: IncomingMessage, dialect: Dialect): boolean {
  const bearer = /^Bearer\s+\S/i.test(headerValue(req, 'authorization') ?? '');
  if (dialect === 'openai') return bearer;
  return bearer || (headerValue(req, 'x-api-key') ?? '').trim().length > 0;
}

function refuse(
  res: ServerResponse,
  dialect: Dialect,
  status: number,
  message: string,
): void {
  const reply = errorReply(dialect, status, 0, message);
  sendJson(res, reply.status, reply.body, reply.headers);
}

/** Parse a JSON object body, or answer 400 and return null. */
function parseJsonBody(
  raw: Buffer,
  res: ServerResponse,
  dialect: Dialect,
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    refuse(
      res,
      dialect,
      400,
      `We could not parse the JSON body of your request: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    refuse(res, dialect, 400, 'The request body must be a JSON object.');
    return null;
  }
  return parsed as Record<string, unknown>;
}

async function route(
  ctx: MockContext,
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  arrivedAt: number,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') {
    if (path === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (path === '/metrics') {
      sendBytes(
        res,
        200,
        'text/plain; version=0.0.4; charset=utf-8',
        ctx.metrics.render(),
      );
      return;
    }
    // The listing is public, as OpenRouter's is: the platform's catalog
    // fetch may run without the organization's key.
    if (path === '/models') {
      sendJson(res, 200, modelsListing());
      return;
    }
    if (path.startsWith('/models/')) {
      const model = findMockModel(
        decodeURIComponent(path.slice('/models/'.length)),
      );
      if (model === undefined)
        refuse(res, 'openai', 404, 'The model does not exist.');
      else sendJson(res, 200, listingEntry(model));
      return;
    }
    refuse(res, 'openai', 404, `Unknown route ${method} ${path}`);
    return;
  }
  if (method !== 'POST') {
    refuse(res, 'openai', 405, `Method ${method} is not allowed on ${path}`);
    return;
  }

  const dialect = dialectOf(path);
  const known = routeLabel(path) !== 'not_found';
  if (!known) {
    refuse(res, dialect, 404, `Unknown route POST ${path}`);
    return;
  }
  if (!authenticated(req, dialect)) {
    refuse(
      res,
      dialect,
      401,
      dialect === 'anthropic'
        ? 'x-api-key header is required'
        : 'You did not provide an API key. Send it as "Authorization: Bearer <key>".',
    );
    return;
  }

  let raw: Buffer;
  try {
    raw = await readBody(req);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      res.setHeader('connection', 'close');
      refuse(res, dialect, 413, error.message);
      return;
    }
    throw error;
  }
  if (path === '/audio/transcriptions') {
    await handleTranscription(ctx, res, raw, arrivedAt);
    return;
  }
  const body = parseJsonBody(raw, res, dialect);
  if (body === null) return;
  const badRequest = (message: string): void =>
    refuse(res, dialect, 400, message);

  switch (path) {
    case '/chat/completions':
      await handleChatCompletions(ctx, res, body, arrivedAt, badRequest);
      return;
    case '/messages':
      await handleMessages(
        ctx,
        res,
        body,
        raw.toString('utf8'),
        arrivedAt,
        badRequest,
      );
      return;
    case '/messages/count_tokens': {
      const counted = countMessageTokens(body, raw.toString('utf8'));
      if (typeof counted === 'string') badRequest(counted);
      else sendJson(res, 200, counted);
      return;
    }
    case '/embeddings':
      await handleEmbeddings(ctx, res, body, arrivedAt, badRequest);
      return;
    case '/images/generations':
      await handleImageGeneration(ctx, res, body, arrivedAt);
      return;
    case '/audio/speech':
      await handleSpeech(ctx, res, body, arrivedAt);
      return;
    default:
      handleModeration(ctx, res, body);
  }
}

function hostForUrl(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '') return '127.0.0.1';
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * Start a mock provider. `input` is resolved like the CLI's flags (over
 * `env`, over the defaults); pass `port: 0` for an ephemeral port.
 */
export async function createMockServer(
  input: MockOptionsInput = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<MockServer> {
  const options = parseMockOptions(input, env);
  const metrics = new MockMetrics();
  const ctx = new MockContext(options, metrics);

  const server = createServer(
    { noDelay: true, keepAlive: true, requestTimeout: 0 },
    (req, res) => {
      const arrivedAt = performance.now();
      const path = routeOf(req.url ?? '/');
      res.once('close', () => {
        metrics.recordRequest(
          routeLabel(path),
          res.headersSent ? String(res.statusCode) : '499',
        );
      });
      route(ctx, req, res, path, arrivedAt).catch((error: unknown) => {
        console.error('[mock] request failed:', error);
        if (!res.headersSent) {
          refuse(
            res,
            dialectOf(path),
            500,
            'The mock failed to serve the request.',
          );
        } else {
          res.destroy();
        }
      });
    },
  );
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = 0;
  server.timeout = 0;
  server.maxRequestsPerSocket = 0;

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen({ host: options.host, port: options.port }, () => {
      server.off('error', onError);
      resolve();
    });
  });
  server.on('error', (error) => {
    console.error('[mock] server error:', error);
  });
  const address = server.address() as AddressInfo;
  const url = `http://${hostForUrl(options.host)}:${address.port}`;

  let closing: Promise<void> | null = null;
  return {
    url,
    port: address.port,
    options,
    metrics,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
