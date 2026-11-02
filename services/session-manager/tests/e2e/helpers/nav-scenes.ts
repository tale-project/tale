import { expect, type APIRequestContext, type Page } from '@playwright/test';

import type { Proxy, Secret, Session } from '../../../lib/api/schemas';
import type { AppApi } from './api';
import type { Control } from './control';
import { TIMEOUT } from './env';
import { fill, t } from './i18n';

/**
 * Scenes the navigation and accessibility specs look at: a manager with
 * sessions in each state a person meets, a pool with working and failing
 * proxies, secrets of every kind. They are made through the API and the
 * controls of the fakes, so what the page shows is what the manager holds.
 */

/** What the fake browser calls a tab: its title is "Title of <address>". */
export function fakeTabTitle(address: string): string {
  return `Title of ${address}`;
}

/** The title of the credentials in `secretsOfEveryKind`. */
export const SHOP_TITLE = 'Example shop';

export interface SessionsInEveryState {
  running: Session;
  stopped: Session;
  failed: Session;
}

/**
 * Three sessions: `alpha` running, `bravo` stopped and `charlie` that could
 * not start (the list shows the newest first: charlie, bravo, alpha).
 */
export async function sessionsInEveryState(
  api: AppApi,
  control: Control,
): Promise<SessionsInEveryState> {
  const running = await api.startSession('alpha');
  const stopped = await api.stopSession((await api.startSession('bravo')).id);

  await api.addProxies(1);
  await control.faults({ launchError: 'The browser could not start.' });
  try {
    const created = await api.createSession('charlie');
    const failed = await api.waitForStatus(created.id, 'error');
    return { running, stopped, failed };
  } finally {
    await control.faults({ launchError: null });
  }
}

/** `host:port` of the session's proxy: the key `control.exitIps` takes its answers by. */
export function hostPortOf(session: Session): string {
  if (session.proxy === null) {
    throw new Error(`Session ${session.name} has no proxy`);
  }
  return new URL(session.proxy.display).host;
}

/** The IP a proxy that changed its exit comes out through (a documentation address). */
export const CHANGED_EXIT_IP = '203.0.113.200';

/** Why the fake check says a proxy does not work. */
const BROKEN_PROXY_REASON = 'Connection refused';

export interface IpChange {
  /** The session as it stands once the change is known: its proxy's exit IP is the new one. */
  session: Session;
  /** The exit IP the session started with. */
  was: string;
  /** The one its proxy comes out through now. */
  now: string;
}

/**
 * A running session whose proxy now exits through another IP than the one it
 * started with, found out by a check of the exit IP: its page carries the
 * amber bar, its chip a warning triangle, its row "IP changed · restart
 * recommended".
 */
export async function sessionWhoseIpChanged(
  api: AppApi,
  control: Control,
  request: APIRequestContext,
  name = 'golf',
): Promise<IpChange> {
  const started = await api.startSession(name);
  await control.exitIps({
    [hostPortOf(started)]: { ip: CHANGED_EXIT_IP, country: 'DE' },
  });
  const checked = await request.post(`/api/sessions/${started.id}/check-ip`);
  expect(checked.ok(), 'the check of the exit IP').toBe(true);
  return {
    session: await api.session(started.id),
    was: started.proxy?.exitIp ?? '',
    now: CHANGED_EXIT_IP,
  };
}

/** A session's name inside a sentence, quoted the way the page quotes it. */
export function quoted(name: string): string {
  return fill(t('sessions.quoted'), { text: name });
}

/**
 * A stopped session whose own proxy has stopped working, and a spare one that
 * works: starting the session asks what to do about its proxy.
 */
export async function sessionWithBrokenProxy(
  api: AppApi,
  control: Control,
  name = 'hotel',
): Promise<Session> {
  const session = await api.stopSession((await api.startSession(name)).id);
  await api.addProxies(1);
  await control.exitIps({
    [hostPortOf(session)]: { error: BROKEN_PROXY_REASON },
  });
  return session;
}

/**
 * A running session and one spare proxy that fails its check: rotating the IP
 * finds no proxy that works, and asks for proxies that do.
 */
export async function sessionWithoutWorkingSpare(
  api: AppApi,
  control: Control,
  name = 'india',
): Promise<Session> {
  const session = await api.startSession(name);
  const [spare] = await api.addProxies(1);
  if (spare === undefined) throw new Error('The spare proxy was not added');
  await control.exitIps({
    [`${spare.host}:${spare.port}`]: { error: BROKEN_PROXY_REASON },
  });
  return session;
}

/** Proxies that work (free and in use) and one that does not, the check done. */
export async function proxiesWorkingAndNot(
  api: AppApi,
  control: Control,
): Promise<{ failing: Proxy }> {
  await api.addProxies(3);
  const failingAddress = '203.0.113.90:8080';
  await control.exitIps({ [failingAddress]: { error: 'Connection refused' } });
  const { added } = await api.importProxies(failingAddress);
  const [failing] = added;
  if (failing === undefined) throw new Error('The failing proxy was not added');
  await expect
    .poll(
      async () =>
        (await api.proxies()).find((proxy) => proxy.id === failing.id)?.check
          .status,
      {
        timeout: TIMEOUT.BACKGROUND,
        message: 'the failing proxy has been checked',
      },
    )
    .toBe('failed');
  return { failing };
}

/** One secret of each kind, the credentials with a password and the card with a number and a CVC (the masked fields). */
export async function secretsOfEveryKind(
  api: AppApi,
  sessionId: number,
): Promise<Secret[]> {
  return [
    await api.createSecret({
      kind: 'credentials',
      title: SHOP_TITLE,
      fields: [
        { label: 'Website', value: 'https://shop.example' },
        { label: 'Username', value: 'jane' },
        { label: 'Password', value: 'hunter2' },
      ],
    }),
    await api.createSecret({
      kind: 'card',
      title: 'Visa ending 4242',
      sessionId,
      fields: [
        { label: 'Cardholder', value: 'Jane Doe' },
        { label: 'Card number', value: '4242424242424242' },
        { label: 'Expiry', value: '12/30' },
        { label: 'CVC', value: '123' },
      ],
    }),
    await api.createSecret({
      kind: 'personal',
      title: 'My details',
      fields: [
        { label: 'Name', value: 'Jane Doe' },
        { label: 'Email', value: 'jane@example.com' },
      ],
    }),
    await api.createSecret({
      kind: 'note',
      title: 'Notes',
      fields: [{ label: 'Note', value: 'Remember the milk\nand the eggs' }],
    }),
  ];
}

/** What the page is told about a session instead of what the manager holds. */
export type SessionPatch = Partial<
  Pick<Session, 'status' | 'activity' | 'error' | 'errorCode'>
>;

/**
 * Shows sessions in a state that only lasts a moment in the real manager (a
 * browser being launched, a proxy being assigned, the browser stopping) or
 * that the fakes cannot be put in (a refusal with a given code), by answering
 * the page's reads of them with that state. The sessions are the real ones;
 * only the answer is changed, so the page parses and draws what it would for
 * the manager in that state. `patches` maps a session id to what differs.
 */
export async function showSessionPatches(
  page: Page,
  patches: ReadonlyMap<number, SessionPatch>,
): Promise<void> {
  const patched = (body: unknown): unknown => {
    if (Array.isArray(body)) return body.map(patched);
    if (typeof body !== 'object' || body === null) return body;
    const id = 'id' in body ? body.id : undefined;
    const patch = typeof id === 'number' ? patches.get(id) : undefined;
    return patch === undefined ? body : { ...body, ...patch };
  };
  await page.route('**/api/sessions**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: patched(await response.json()) });
  });
}

/** Shows proxies as still being checked (the check of a real one is over in a moment). */
export async function showProxiesChecking(
  page: Page,
  ids: ReadonlySet<number>,
): Promise<void> {
  const patched = (body: unknown): unknown => {
    if (Array.isArray(body)) return body.map(patched);
    if (typeof body !== 'object' || body === null) return body;
    const id = 'id' in body ? body.id : undefined;
    if (typeof id !== 'number' || !ids.has(id) || !('check' in body)) {
      return body;
    }
    const check = typeof body.check === 'object' ? body.check : {};
    return {
      ...body,
      check: { ...check, status: 'checking', latencyMs: null, error: null },
    };
  };
  await page.route('**/api/proxies**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: patched(await response.json()) });
  });
}
