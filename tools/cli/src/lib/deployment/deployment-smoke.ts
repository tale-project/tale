/**
 * `tale deploy smoke`: does a running deployment answer the way a browser
 * needs it to, through its public origin?
 *
 * The public probe sends no credentials and writes nothing, so it is safe
 * against any deployment: health and readiness through the proxy, the app
 * shell and one of its scripts, an anonymous session read, and the two
 * session gates (`/events` and `/api/app`) refusing a stranger — a 200 there
 * would mean the lane fell through to the web tier's HTML fallback.
 *
 * The full journey signs a dedicated account in, holds the organization's
 * live-event stream, creates a task and waits for its realtime hint, reads
 * it back and deletes it — or archives it, when the account may not delete
 * tasks; `--chat` adds one model turn, which spends tokens. Whatever it
 * created is removed (a chat thread goes to the trash, which is all the app
 * offers, stopped first if its turn is still running) and the session is
 * signed out, even after a failure.
 */

import { createParser } from 'eventsource-parser';
import { z } from 'zod';

export const SMOKE_EMAIL_ENV = 'TALE_SMOKE_EMAIL';
export const SMOKE_PASSWORD_ENV = 'TALE_SMOKE_PASSWORD';

const BODY_LIMIT = 4 * 1024 * 1024;
const SMOKE_TITLE = 'Tale deployment smoke';

export interface SmokeCredentials {
  email: string;
  password: string;
}

export interface DeploymentSmokeOptions {
  /** The deployment's public URL, including a subpath when it has one. */
  url: string;
  expectedVersion?: string;
  /** Sign in and run the user journey; requires `credentials`. */
  credentials?: SmokeCredentials;
  organization?: string;
  project?: string;
  /** Add one chat turn to the journey (spends model tokens). */
  chat?: boolean;
  /** Bound on one request or one wait, in milliseconds. */
  timeoutMs: number;
  /** Bound on the chat turn, in milliseconds. */
  turnTimeoutMs: number;
  request?: typeof fetch;
  now?: () => number;
}

export type SmokeStatus = 'pass' | 'fail' | 'skip';

export interface SmokeCheck {
  name: string;
  status: SmokeStatus;
  ms: number;
  detail: string;
}

export interface DeploymentSmokeReport {
  url: string;
  mode: 'public' | 'full';
  version: string | null;
  passed: boolean;
  checks: SmokeCheck[];
}

/** A check's own refusal: the detail is the operator-facing sentence. */
export class SmokeFailure extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Where a deployment answers: its origin and its base path (`''` at the root). */
export interface SmokeTarget {
  origin: string;
  basePath: string;
}

/** Read `--url`: https, or plain http on a loopback name; no credentials. */
export function smokeTarget(raw: string): SmokeTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SmokeFailure(`"${raw}" is not a URL.`);
  }
  if (url.username || url.password)
    throw new SmokeFailure('The URL must not carry credentials.');
  if (url.search || url.hash)
    throw new SmokeFailure('The URL must not carry a query or fragment.');
  const secure = url.protocol === 'https:';
  if (!secure && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    throw new SmokeFailure(
      'Use an https:// URL; plain http is accepted only for localhost.',
    );
  return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, '') };
}

interface Reply {
  status: number;
  headers: Headers;
  text: string;
}

const jsonObject = z.record(z.string(), z.unknown());

function parseJson<T>(reply: Reply, schema: z.ZodType<T>, what: string): T {
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch {
    throw new SmokeFailure(`${what} answered ${reply.status} without JSON.`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new SmokeFailure(
      `${what} answered ${reply.status} with an unexpected body.`,
    );
  return parsed.data;
}

function expectStatus(reply: Reply, status: number, what: string): void {
  if (reply.status !== status)
    throw new SmokeFailure(
      `${what} answered ${reply.status}, expected ${status}.`,
    );
}

/** App writes answer 200 or 201 depending on the door; both succeeded. */
function expectSuccess(reply: Reply, what: string): void {
  if (reply.status < 200 || reply.status > 299)
    throw new SmokeFailure(
      `${what} answered ${reply.status}, expected success.`,
    );
}

/** One browser-shaped client: a cookie jar, `Origin` on writes, bounded reads. */
class SmokeClient {
  readonly #base: SmokeTarget;
  readonly #request: typeof fetch;
  readonly #timeoutMs: number;
  readonly #cookies = new Map<string, string>();

  constructor(base: SmokeTarget, request: typeof fetch, timeoutMs: number) {
    this.#base = base;
    this.#request = request;
    this.#timeoutMs = timeoutMs;
  }

  /** Whether a response left this client holding a cookie. */
  holdsCookies(): boolean {
    return this.#cookies.size > 0;
  }

  url(path: string, query?: Record<string, string>): string {
    const url = new URL(`${this.#base.basePath}${path}`, this.#base.origin);
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.set(key, value);
    return url.toString();
  }

  #headers(method: string, extra: Record<string, string>): Headers {
    const headers = new Headers(extra);
    if (this.#cookies.size > 0)
      headers.set(
        'Cookie',
        [...this.#cookies]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      );
    if (method !== 'GET') headers.set('Origin', this.#base.origin);
    return headers;
  }

  #remember(headers: Headers): void {
    for (const line of headers.getSetCookie()) {
      const pair = line.split(';', 1)[0] ?? '';
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      // A cleared cookie comes back empty (or with a past expiry).
      if (value === '' || /;\s*max-age=0\b/i.test(line))
        this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, string>;
      json?: unknown;
      accept?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<Reply> {
    const headers = this.#headers(method, {
      Accept: options.accept ?? 'application/json',
      'Cache-Control': 'no-cache',
    });
    if (options.json !== undefined)
      headers.set('Content-Type', 'application/json');
    const response = await this.#request(this.url(path, options.query), {
      method,
      headers,
      redirect: 'manual',
      body:
        options.json === undefined ? undefined : JSON.stringify(options.json),
      signal: AbortSignal.timeout(options.timeoutMs ?? this.#timeoutMs),
    });
    this.#remember(response.headers);
    return {
      status: response.status,
      headers: response.headers,
      text: await readBounded(response),
    };
  }

  /** Hold an event stream open; `close` ends it. */
  async stream(
    path: string,
    query: Record<string, string>,
    onEvent: (event: string, data: string) => void,
  ): Promise<{ status: number; contentType: string; close: () => void }> {
    // Only the open is bounded: the held stream lasts until `close`.
    const controller = new AbortController();
    const opening = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#request(this.url(path, query), {
        headers: this.#headers('GET', { Accept: 'text/event-stream' }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(opening);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const body = response.body;
    if (response.status !== 200 || body === null) {
      controller.abort();
      await response.body?.cancel().catch((error: unknown) => {
        console.warn('[smoke] could not discard a refused stream', error);
      });
      return { status: response.status, contentType, close: () => {} };
    }
    const parser = createParser({
      onEvent: (event) => onEvent(event.event ?? 'message', event.data),
    });
    const reader = body.pipeThrough(new TextDecoderStream()).getReader();
    void (async () => {
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) return;
          parser.feed(next.value);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          console.warn('[smoke] the event stream ended early', error);
      }
    })();
    return {
      status: response.status,
      contentType,
      close: () => {
        controller.abort();
        reader.cancel().catch((error: unknown) => {
          console.warn('[smoke] could not close the event stream', error);
        });
      },
    };
  }
}

async function readBounded(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw new SmokeFailure('A response exceeded the 4 MiB read bound.');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The first module script the app shell loads, relative to the base path. */
export function shellScript(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src !== undefined) return src;
  }
  return null;
}

/** Wait until `test` holds or `timeoutMs` passes; `wake` re-checks early. */
function waitFor(
  test: () => boolean,
  timeoutMs: number,
): { promise: Promise<boolean>; wake: () => void } {
  let wake = () => {};
  const promise = new Promise<boolean>((resolve) => {
    if (test()) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(test()), timeoutMs);
    wake = () => {
      if (!test()) return;
      clearTimeout(timer);
      resolve(true);
    };
  });
  return { promise, wake };
}

const healthSchema = z.object({ status: z.literal('ok'), version: z.string() });
const readySchema = z.object({ ok: z.literal(true) });
const sessionSchema = z
  .object({
    user: z.object({ id: z.string() }),
    session: z
      .object({ activeOrganizationId: z.string().nullish() })
      .passthrough(),
  })
  .passthrough();
const signInSchema = z
  .object({ twoFactorRedirect: z.boolean().optional() })
  .passthrough();
const organizationsSchema = z.array(
  z.object({ id: z.string(), slug: z.string().nullish() }).passthrough(),
);
const projectsSchema = z
  .object({
    projects: z.array(
      z.object({ id: z.string(), name: z.string().nullish() }).passthrough(),
    ),
  })
  .passthrough();
const hintSchema = z
  .object({ entity: z.string(), entityId: z.string().nullish() })
  .passthrough();
const modelsSchema = z
  .object({
    models: z.array(
      z.object({ id: z.string(), providerSlug: z.string() }).passthrough(),
    ),
  })
  .passthrough();
const turnSchema = z
  .object({
    status: z.enum(['completed', 'refused']),
    reason: z.string().nullish(),
  })
  .passthrough();
const messagesSchema = z
  .object({
    messages: z.array(
      z
        .object({
          role: z.string(),
          parts: z.array(jsonObject).nullish(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export async function runDeploymentSmoke(
  options: DeploymentSmokeOptions,
): Promise<DeploymentSmokeReport> {
  const base = smokeTarget(options.url);
  const now = options.now ?? (() => performance.now());
  const client = new SmokeClient(
    base,
    options.request ?? fetch,
    options.timeoutMs,
  );
  const checks: SmokeCheck[] = [];
  let version: string | null = null;

  const check = async (
    name: string,
    body: () => Promise<string>,
  ): Promise<boolean> => {
    const started = now();
    try {
      const detail = await body();
      checks.push({ name, status: 'pass', ms: now() - started, detail });
      return true;
    } catch (error) {
      const detail =
        error instanceof SmokeFailure
          ? error.message
          : `The request failed: ${error instanceof Error ? error.message : String(error)}`;
      checks.push({ name, status: 'fail', ms: now() - started, detail });
      return false;
    }
  };
  const skip = (name: string, detail: string) =>
    checks.push({ name, status: 'skip', ms: 0, detail });

  // --- Public: no credentials, no writes. ---------------------------------
  await check('health', async () => {
    const reply = await client.call('GET', '/api/health');
    expectStatus(reply, 200, 'GET /api/health');
    const health = parseJson(reply, healthSchema, 'GET /api/health');
    version = health.version;
    if (
      options.expectedVersion !== undefined &&
      health.version !== options.expectedVersion
    )
      throw new SmokeFailure(
        `The deployment serves ${health.version}, expected ${options.expectedVersion}.`,
      );
    return `serving ${health.version}`;
  });
  await check('ready', async () => {
    const reply = await client.call('GET', '/api/health/ready');
    expectStatus(reply, 200, 'GET /api/health/ready');
    parseJson(reply, readySchema, 'GET /api/health/ready');
    return 'the API and its database answer';
  });
  await check('shell', async () => {
    const reply = await client.call('GET', '/', { accept: 'text/html' });
    expectStatus(reply, 200, 'GET /');
    if (!(reply.headers.get('content-type') ?? '').includes('text/html'))
      throw new SmokeFailure('GET / did not answer HTML.');
    const src = shellScript(reply.text);
    if (src === null)
      throw new SmokeFailure('The app shell names no module script.');
    const script = new URL(src, client.url('/'));
    if (
      script.origin !== base.origin ||
      !script.pathname.startsWith(`${base.basePath}/`)
    )
      throw new SmokeFailure('The app shell loads its script from elsewhere.');
    const asset = await client.call(
      'GET',
      script.pathname.slice(base.basePath.length),
      { accept: '*/*' },
    );
    expectStatus(asset, 200, `GET ${script.pathname}`);
    if (!/javascript/.test(asset.headers.get('content-type') ?? ''))
      throw new SmokeFailure(`${script.pathname} is not served as a script.`);
    return `shell and ${script.pathname} load`;
  });
  await check('anonymous-session', async () => {
    const reply = await client.call('GET', '/api/auth/get-session');
    expectStatus(reply, 200, 'GET /api/auth/get-session');
    if (parseJson(reply, z.null(), 'GET /api/auth/get-session') !== null)
      throw new SmokeFailure('An anonymous request was given a session.');
    return 'no session without a cookie';
  });
  await check('events-gate', async () => {
    const reply = await client.call('GET', '/events', {
      query: { orgId: 'smoke-probe' },
      accept: 'text/event-stream',
    });
    expectStatus(reply, 401, 'GET /events');
    return 'the live-event stream refuses a stranger';
  });
  await check('api-gate', async () => {
    const reply = await client.call('GET', '/api/app/projects', {
      query: { orgId: 'smoke-probe' },
    });
    expectStatus(reply, 401, 'GET /api/app/projects');
    return 'the app API refuses a stranger';
  });

  const credentials = options.credentials;
  if (credentials === undefined) return finish(base, 'public', version, checks);

  // --- Full journey: a dedicated account, cleaned up afterwards. -----------
  const journey = [
    'sign-in',
    'organization',
    'events',
    'project',
    'task',
    'realtime',
    ...(options.chat ? ['chat'] : []),
  ];
  const skipRest = (from: string, detail: string) => {
    for (const name of journey.slice(journey.indexOf(from))) skip(name, detail);
  };
  let organizationId = '';
  let projectId = '';
  let taskId: string | null = null;
  let threadId: string | null = null;
  const hints: { entity: string; entityId?: string | null }[] = [];
  let wakeHint = () => {};
  let closeStream = () => {};
  let signedIn = false;

  try {
    signedIn = await check('sign-in', async () => {
      const reply = await client.call('POST', '/api/auth/sign-in/email', {
        json: {
          email: credentials.email,
          password: credentials.password,
          rememberMe: false,
        },
      });
      if (reply.status === 401)
        throw new SmokeFailure('The smoke account was refused sign-in.');
      expectStatus(reply, 200, 'POST /api/auth/sign-in/email');
      if (parseJson(reply, signInSchema, 'Sign-in').twoFactorRedirect)
        throw new SmokeFailure(
          'The smoke account needs a second factor; use one without it.',
        );
      const session = await client.call('GET', '/api/auth/get-session');
      expectStatus(session, 200, 'GET /api/auth/get-session');
      parseJson(session, sessionSchema, 'GET /api/auth/get-session');
      return 'signed in with a session';
    });
    if (!signedIn) {
      skipRest('organization', 'Needs a signed-in session.');
      return finish(base, 'full', version, checks);
    }

    const scoped = await check('organization', async () => {
      const reply = await client.call('GET', '/api/auth/organization/list');
      expectStatus(reply, 200, 'GET /api/auth/organization/list');
      const organizations = parseJson(
        reply,
        organizationsSchema,
        'GET /api/auth/organization/list',
      );
      const wanted = options.organization;
      const found =
        wanted === undefined
          ? organizations[0]
          : organizations.find((o) => o.id === wanted || o.slug === wanted);
      if (found === undefined)
        throw new SmokeFailure(
          wanted === undefined
            ? 'The smoke account belongs to no organization.'
            : `The smoke account is not a member of "${wanted}".`,
        );
      organizationId = found.id;
      return `organization ${found.slug ?? found.id}`;
    });
    if (!scoped) {
      skipRest('events', 'Needs an organization.');
      return finish(base, 'full', version, checks);
    }
    const orgQuery = { orgId: organizationId };

    const streaming = await check('events', async () => {
      const stream = await client.stream('/events', orgQuery, (event, data) => {
        if (event !== 'hint') return;
        try {
          const hint = hintSchema.safeParse(JSON.parse(data));
          if (hint.success) hints.push(hint.data);
        } catch (error) {
          console.warn('[smoke] unparseable hint event', error);
        }
        wakeHint();
      });
      closeStream = stream.close;
      if (stream.status !== 200)
        throw new SmokeFailure(
          `GET /events answered ${stream.status}, expected 200.`,
        );
      if (!stream.contentType.includes('text/event-stream'))
        throw new SmokeFailure('GET /events is not an event stream.');
      return 'live-event stream open';
    });

    const located = await check('project', async () => {
      const reply = await client.call('GET', '/api/app/projects', {
        query: { ...orgQuery, includeArchived: 'false', summary: 'true' },
      });
      expectStatus(reply, 200, 'GET /api/app/projects');
      const { projects } = parseJson(
        reply,
        projectsSchema,
        'GET /api/app/projects',
      );
      const wanted = options.project;
      const found =
        wanted === undefined
          ? (projects.find((p) => p.name === SMOKE_TITLE) ?? projects[0])
          : projects.find((p) => p.id === wanted);
      if (found !== undefined) {
        projectId = found.id;
        return `project ${found.name ?? found.id}`;
      }
      if (wanted !== undefined)
        throw new SmokeFailure(
          `The smoke account cannot see project ${wanted}.`,
        );
      // A fresh account has nothing yet: keep one named project for every
      // later run instead of creating one each time.
      const created = await client.call('POST', '/api/app/projects', {
        query: orgQuery,
        json: { name: SMOKE_TITLE },
      });
      expectSuccess(created, 'POST /api/app/projects');
      projectId = parseJson(
        created,
        z.object({ projectId: z.string() }).passthrough(),
        'POST /api/app/projects',
      ).projectId;
      return `created the project "${SMOKE_TITLE}" for later runs`;
    });
    if (!located) {
      skipRest('task', 'Needs a project.');
      return finish(base, 'full', version, checks);
    }

    const created = await check('task', async () => {
      const reply = await client.call('POST', '/api/app/tasks', {
        query: orgQuery,
        json: {
          projectId,
          title: `${SMOKE_TITLE} ${new Date().toISOString()}`,
          description: 'Created and deleted by tale deploy smoke.',
        },
      });
      expectSuccess(reply, 'POST /api/app/tasks');
      const id = parseJson(
        reply,
        z.object({ taskId: z.string() }).passthrough(),
        'POST /api/app/tasks',
      ).taskId;
      taskId = id;
      const read = await client.call(
        'GET',
        `/api/app/tasks/${encodeURIComponent(id)}`,
        { query: orgQuery },
      );
      expectStatus(read, 200, 'GET /api/app/tasks/:taskId');
      return 'created and read back';
    });

    if (!created || !streaming)
      skip('realtime', 'Needs the live-event stream and a new task.');
    else
      await check('realtime', async () => {
        const seen = () =>
          hints.some((h) => h.entity === 'task' && h.entityId === taskId);
        const wait = waitFor(seen, options.timeoutMs);
        wakeHint = wait.wake;
        if (!(await wait.promise))
          throw new SmokeFailure(
            `No live hint for the new task within ${Math.round(options.timeoutMs / 1000)} s.`,
          );
        return 'the open stream heard about the task';
      });

    if (options.chat)
      await check('chat', async () => {
        const models = await client.call(
          'GET',
          '/api/app/chat/composer/models',
          {
            query: orgQuery,
          },
        );
        expectStatus(models, 200, 'GET /api/app/chat/composer/models');
        const model = parseJson(
          models,
          modelsSchema,
          'GET /api/app/chat/composer/models',
        ).models[0];
        if (model === undefined)
          throw new SmokeFailure('No chat model is available to the account.');
        const thread = await client.call('POST', '/api/app/chat/threads', {
          query: orgQuery,
          json: { title: SMOKE_TITLE },
        });
        expectSuccess(thread, 'POST /api/app/chat/threads');
        const id = parseJson(
          thread,
          z.object({ id: z.string() }).passthrough(),
          'POST /api/app/chat/threads',
        ).id;
        threadId = id;
        const path = `/api/app/chat/threads/${encodeURIComponent(id)}`;
        const turn = await client.call('POST', `${path}/messages`, {
          query: orgQuery,
          json: {
            text: 'Reply with the single word: ready',
            modelId: model.id,
            providerSlug: model.providerSlug,
          },
          timeoutMs: options.turnTimeoutMs,
        });
        expectSuccess(turn, 'POST /api/app/chat/threads/:id/messages');
        const outcome = parseJson(turn, turnSchema, 'The chat turn');
        if (outcome.status !== 'completed')
          throw new SmokeFailure(
            `The chat turn was refused${outcome.reason ? `: ${outcome.reason}` : ''}.`,
          );
        const transcript = await client.call('GET', `${path}/messages`, {
          query: orgQuery,
        });
        expectStatus(transcript, 200, 'GET /api/app/chat/threads/:id/messages');
        const reply = parseJson(
          transcript,
          messagesSchema,
          'GET /api/app/chat/threads/:id/messages',
        ).messages.findLast((m) => m.role === 'assistant');
        const text = (reply?.parts ?? [])
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('')
          .trim();
        if (text === '')
          throw new SmokeFailure('The model turn completed without a reply.');
        return `${model.providerSlug}/${model.id} replied`;
      });
  } finally {
    closeStream();
    // A sign-in that set a session cookie but then failed its check still
    // left a session behind: sign that one out too.
    if (signedIn || client.holdsCookies())
      await cleanUp(
        client,
        check,
        { organizationId, timeoutMs: options.timeoutMs },
        taskId,
        threadId,
      );
  }
  return finish(base, 'full', version, checks);
}

async function cleanUp(
  client: SmokeClient,
  check: (name: string, body: () => Promise<string>) => Promise<boolean>,
  options: { organizationId: string; timeoutMs: number },
  taskId: string | null,
  threadId: string | null,
): Promise<void> {
  const query = { orgId: options.organizationId };
  if (taskId !== null)
    await check('cleanup-task', async () => {
      const path = `/api/app/tasks/${encodeURIComponent(taskId)}`;
      const reply = await client.call('DELETE', path, { query });
      if (reply.status !== 403) {
        expectSuccess(reply, 'DELETE /api/app/tasks/:taskId');
        return 'the smoke task is deleted';
      }
      // Owners and admins delete; the task's creator may archive it, which
      // also takes it off every board.
      const archived = await client.call('POST', `${path}/archive`, {
        query,
        json: {},
      });
      expectSuccess(archived, 'POST /api/app/tasks/:taskId/archive');
      return 'the smoke task is archived (the account may not delete tasks)';
    });
  if (threadId !== null)
    await check('cleanup-thread', async () => {
      const path = `/api/app/chat/threads/${encodeURIComponent(threadId)}`;
      const trash = async (): Promise<boolean> => {
        const reply = await client.call('POST', `${path}/trash`, {
          query,
          json: {},
        });
        expectSuccess(reply, 'POST /api/app/chat/threads/:id/trash');
        return parseJson(
          reply,
          z.object({ ok: z.boolean() }).passthrough(),
          'POST /api/app/chat/threads/:id/trash',
        ).ok;
      };
      if (await trash()) return 'the smoke conversation is in the trash';
      // A turn that outlived the wait is still generating, and a thread
      // mid-turn refuses the trash: stop it, then trash it once it settled.
      const cancelled = await client.call('POST', `${path}/cancel`, {
        query,
        json: {},
      });
      expectSuccess(cancelled, 'POST /api/app/chat/threads/:id/cancel');
      const deadline = Date.now() + options.timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (await trash())
          return 'the smoke conversation was stopped and is in the trash';
      }
      throw new SmokeFailure(
        'The smoke conversation was stopped but did not settle in time; it stays in place.',
      );
    });
  await check('sign-out', async () => {
    const reply = await client.call('POST', '/api/auth/sign-out', { json: {} });
    expectStatus(reply, 200, 'POST /api/auth/sign-out');
    return 'signed out';
  });
}

function finish(
  base: SmokeTarget,
  mode: DeploymentSmokeReport['mode'],
  version: string | null,
  checks: SmokeCheck[],
): DeploymentSmokeReport {
  return {
    url: `${base.origin}${base.basePath}`,
    mode,
    version,
    passed: checks.every((c) => c.status !== 'fail'),
    checks: checks.map((c) => ({ ...c, ms: Math.round(c.ms) })),
  };
}
