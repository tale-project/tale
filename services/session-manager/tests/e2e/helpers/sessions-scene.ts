import {
  expect,
  type APIRequestContext,
  type Page,
  type Route,
} from '@playwright/test';
import { z } from 'zod';

import {
  metaSchema,
  sessionSchema,
  type Meta,
  type Proxy,
  type Session,
} from '../../../lib/api/schemas';
import type { AppApi } from './api';
import { TIMEOUT } from './env';
import { exitLine } from './sessions-page';

/**
 * The launch delay that keeps a start at "Starting" long enough to be looked
 * at: the page asks again every 1.5 s while a session is busy, and the specs
 * run beside other work.
 */
export const SLOW_START_MS = 5000;

/** The proxy check that keeps a session at "Assigning proxy". */
export const SLOW_CHECK_MS = 5000;

/** How many sessions the list loads at a time (`SESSIONS_PAGE_SIZE` of the page). */
export const SESSIONS_PAGE_SIZE = 50;

/** The longest name a session can have, as the page's own sentence says it. */
export function nameLimitOf(sentence: string): number {
  const limit = /(\d+) characters/.exec(sentence)?.[1];
  if (limit === undefined) throw new Error(`No limit in "${sentence}"`);
  return Number(limit);
}

/** `host:port` of the session's proxy: the key `control.exitIps` takes. */
export function hostPortOf(session: Session): string {
  if (session.proxy === null) {
    throw new Error(`Session ${session.name} has no proxy`);
  }
  return new URL(session.proxy.display).host;
}

/** What a running session's row says under its name: where its proxy exits. */
export function lineOf(session: Session): string {
  const { proxy } = session;
  if (proxy?.exitIp == null || proxy.country === null) {
    throw new Error(`Session ${session.name} has no known exit IP`);
  }
  return exitLine(proxy.exitIp, proxy.country);
}

/** Starts a session that exists already, as the page's Start does. */
export async function startAgain(
  request: APIRequestContext,
  id: number,
): Promise<void> {
  const response = await request.post(`/api/sessions/${id}/start`, {
    data: {},
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Gives a session another name, as another client of the API does. */
export async function renameElsewhere(
  request: APIRequestContext,
  id: number,
  name: string,
): Promise<void> {
  const response = await request.patch(`/api/sessions/${id}`, {
    data: { name },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Asks the app to look at the exit IP of the session's proxy now. */
export async function checkIpOf(
  request: APIRequestContext,
  id: number,
): Promise<void> {
  const response = await request.post(`/api/sessions/${id}/check-ip`);
  expect(response.ok(), await response.text()).toBe(true);
}

/** A session that ran and was stopped: it keeps its proxy. */
export async function stoppedSession(
  api: AppApi,
  name: string,
): Promise<Session> {
  const running = await api.startSession(name);
  await api.stopSession(running.id);
  return api.session(running.id);
}

/** A session that ran and was stopped, and lost its proxy to a deletion: the pool is empty again. */
export async function stoppedWithoutProxy(
  api: AppApi,
  name: string,
): Promise<Session> {
  const stopped = await stoppedSession(api, name);
  if (stopped.proxy === null) throw new Error(`${name} has no proxy`);
  await api.deleteProxy(stopped.proxy.id);
  return stopped;
}

/**
 * Sessions of these names, each with a proxy of its own, all running: the
 * oldest first, so the last name is the top row.
 */
export async function createSessions(
  api: AppApi,
  names: readonly string[],
): Promise<Session[]> {
  await api.addProxies(names.length);
  for (const name of names) await api.createSession(name);
  await waitUntilAllRun(api);
  const byName = new Map(
    (await api.sessions()).map((session) => [session.name, session]),
  );
  return names.map((name) => {
    const session = byName.get(name);
    if (session === undefined) throw new Error(`${name} was not created`);
    return session;
  });
}

/**
 * Imports proxies as a provider's export writes them, with credentials
 * (`host:port:user:pass`), and waits until they have been checked.
 */
export async function importWithCredentials(
  api: AppApi,
  lines: readonly string[],
): Promise<Proxy[]> {
  const { added } = await api.importProxies(lines.join('\n'));
  expect(added).toHaveLength(lines.length);
  await expect
    .poll(
      async () =>
        (await api.proxies())
          .filter((proxy) => added.some((one) => one.id === proxy.id))
          .every((proxy) => proxy.check.status === 'ok'),
      {
        timeout: TIMEOUT.BACKGROUND,
        message: 'the imported proxies are checked',
      },
    )
    .toBe(true);
  return added;
}

/** Every session runs, with nothing under way any more. */
export async function waitUntilAllRun(api: AppApi): Promise<void> {
  await expect
    .poll(
      async () =>
        (await api.sessions()).every(
          (session) =>
            session.status === 'running' && session.activity === null,
        ),
      { timeout: TIMEOUT.BACKGROUND, message: 'every session runs' },
    )
    .toBe(true);
}

/**
 * What goes wrong in the page itself, as the browser tells it: an uncaught
 * exception, a promise nobody handled the rejection of, an error in the
 * console. The requests the backend refuses are not among them: the browser
 * writes a line of its own for each ("Failed to load resource"), and a refusal
 * the page tells the person is no fault of the page's.
 */
export function watchPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => {
    problems.push(`uncaught: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!text.startsWith('Failed to load resource')) {
      problems.push(`console: ${text}`);
    }
  });
  return problems;
}

/** Waits for the page to have drawn twice: what a handler queued behind its work has run by then. */
export async function settlePage(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

const sessionsSchema = z.array(sessionSchema);

/**
 * Changes the sessions on their way to the page: the answer of the backend is
 * read, `change` is applied to every session in it, and the page gets the
 * result. For what the fake browser never does (a failure of a kind it does
 * not make), so that the page's words for it can be seen. The backend itself
 * is not told.
 */
export async function changeSessionsOnTheWire(
  page: Page,
  change: (session: Session) => Session,
): Promise<void> {
  await page.route(/\/api\/sessions(?:\/\d+)?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body: unknown = await response.json();
    const changed = Array.isArray(body)
      ? sessionsSchema.parse(body).map(change)
      : change(sessionSchema.parse(body));
    await route.fulfill({ response, json: changed });
  });
}

/**
 * Changes what the app says about itself (`/api/meta`) on its way to the page:
 * for what the fake browser backend is never in (a browser that is being
 * installed, or is not there). The backend itself is not told.
 */
export async function changeMetaOnTheWire(
  page: Page,
  change: (meta: Meta) => Meta,
): Promise<void> {
  await page.route(/\/api\/meta$/, async (route) => {
    const response = await route.fetch();
    const meta = metaSchema.parse(await response.json());
    await route.fulfill({ response, json: change(meta) });
  });
}

/** The sentence a refusal carries for API clients: the page never shows it. */
export const API_SENTENCE = 'A sentence for API clients, never shown.';

/** What the backend answers a refused call with: `{ error, message, ...extra }`. */
export interface Refusal {
  status: number;
  error: string;
  /** The fields besides the code and the message (`doing`, `reason`, `failed`, …). */
  extra?: Record<string, unknown>;
}

/** Answers the writes (not the reads) that match `url` with a refusal, whatever the backend would say. */
export async function refuseWrites(
  page: Page,
  url: RegExp,
  refusal: Refusal,
): Promise<void> {
  await page.route(url, async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: refusal.status,
      json: {
        error: refusal.error,
        message: API_SENTENCE,
        ...refusal.extra,
      },
    });
  });
}
