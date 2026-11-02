// The page's own API client against the real backend: what the page sends is
// what the routes accept, and every answer is one its schemas parse. The
// page's component tests answer with fakes the page's authors wrote, so they
// cannot tell that the backend says `reason` where the page reads `code`;
// this test can.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  existingIdOfRefusal,
  parseCauseOfRefusal,
  sessionOfRefusal,
} from '@/app/features/proxies/lib/refusals';
import { readSharedIpConflict } from '@/app/features/sessions/lib/shared-ip';
import { ApiError } from '@/app/lib/api/client';
import {
  metaApi,
  proxiesApi,
  secretsApi,
  sessionsApi,
  settingsApi,
} from '@/app/lib/api/endpoints';
import { failureText, sessionFailureText } from '@/app/lib/api/failure';
import type { Session } from '@/lib/api/schemas';
import { i18n } from '@/lib/i18n/i18n';

import { loadConfig } from './config.ts';
import { GeoLookupError } from './domains/identity/types.ts';
import { createBackend, type Backend } from './main.ts';
import { FakeBackend, Gate } from './testing/fake-browser.ts';
import { FakeExitIpChecker } from './testing/fake-exit-ip.ts';

const HOST = '127.0.0.1:3004';

let directory: string;
let backend: Backend;
let checker: FakeExitIpChecker;
let browser: FakeBackend;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'session-manager-contract-'));
  checker = new FakeExitIpChecker();
  browser = new FakeBackend();
  backend = createBackend(
    loadConfig(
      { PORT: '3004', SESSION_MANAGER_DATA_DIR: directory },
      { distDir: join(directory, 'dist') },
    ),
    { backend: browser, checker },
  );
  // The page calls relative addresses of its own origin.
  vi.stubGlobal(
    'fetch',
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        `http://${HOST}`,
      );
      const headers = new Headers(init?.headers);
      headers.set('Host', HOST);
      return backend.fetch(new Request(url, { ...init, headers }));
    },
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await backend.close();
  rmSync(directory, { recursive: true, force: true });
});

async function refusalOf(action: Promise<unknown>): Promise<ApiError> {
  const error = await action.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ApiError)) {
    throw new Error(`expected a refusal, got ${String(error)}`);
  }
  return error;
}

async function running(id: number): Promise<Session> {
  let latest: Session | undefined;
  await expect
    .poll(async () => {
      latest = await sessionsApi.get(id);
      return latest.status === 'running' && latest.activity === null;
    })
    .toBe(true);
  if (latest === undefined) throw new Error('no session was read');
  return latest;
}

describe('the settings and the overview', () => {
  it('reads the overview the page is built on', async () => {
    const meta = await metaApi.get();
    expect(meta.browserInstalled).toBe(true);
    expect(meta.counts).toMatchObject({ sessions: 0, proxies: 0 });
    expect(meta.secretKinds.map((kind) => kind.key)).toEqual([
      'personal',
      'credentials',
      'card',
      'note',
    ]);
  });

  it('saves the start page and the AI access, and reads them back', async () => {
    const saved = await settingsApi.update({
      startPage: 'https://example.org',
      mcpEnabled: true,
    });
    expect(saved).toMatchObject({
      startPage: 'https://example.org',
      mcpEnabled: true,
    });
    expect(await settingsApi.get()).toEqual(saved);

    const reset = await settingsApi.update({ startPage: '' });
    expect(reset.startPage).toBe(reset.defaultStartPage);
  });

  it('refuses a start page that is no web address, with a code the page words', async () => {
    const error = await refusalOf(settingsApi.update({ startPage: 'nope' }));
    expect(error.status).toBe(422);
    expect(error.code).toBe('invalid_start_page');
  });
});

describe('the proxies', () => {
  it('adds, lists, checks and deletes a proxy', async () => {
    const added = await proxiesApi.add('203.0.113.7:8080', 'http');
    expect(added).toMatchObject({
      scheme: 'http',
      host: '203.0.113.7',
      port: 8080,
      session: null,
    });

    await expect
      .poll(async () => (await proxiesApi.list({ limit: 50 })).items[0]?.check)
      .toMatchObject({ status: 'ok', exitIp: '203.0.113.7' });

    const checked = await proxiesApi.check(added.id);
    expect(checked.id).toBe(added.id);
    expect(await proxiesApi.checkAll()).toHaveLength(1);

    await proxiesApi.remove(added.id);
    expect((await proxiesApi.list({ limit: 50 })).total).toBe(0);
  });

  it('imports a list, and says which lines it could not use and why', async () => {
    const result = await proxiesApi.import(
      ['198.51.100.1:3128', '198.51.100.1:3128', 'garbage', ''].join('\n'),
      'socks5',
    );
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({ scheme: 'socks5' });
    expect(result.duplicates).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 3 });
    expect(result.errors[0]?.code).toEqual(expect.any(String));
  });

  it('tells the page why a proxy could not be read: the reason and what it is about', async () => {
    const missing = await refusalOf(proxiesApi.add('example.com', 'http'));
    expect(missing.code).toBe('invalid_proxy');
    expect(parseCauseOfRefusal(missing)).toEqual({
      code: 'missing_port',
      params: {},
    });

    const range = await refusalOf(proxiesApi.add('1.2.3.4:99999', 'http'));
    expect(parseCauseOfRefusal(range)).toMatchObject({
      code: 'invalid_port_value',
      params: { port: '99999' },
    });
  });

  it('tells the page which proxy exists already', async () => {
    const first = await proxiesApi.add('203.0.113.8:8080', 'http');
    const again = await refusalOf(proxiesApi.add('203.0.113.8:8080', 'http'));
    expect(again.code).toBe('duplicate');
    expect(existingIdOfRefusal(again)).toBe(first.id);
  });

  it('tells the page which session holds a proxy it may not delete', async () => {
    const proxy = await proxiesApi.add('203.0.113.9:8080', 'http');
    const session = await sessionsApi.create({ name: 'holder' });
    await running(session.id);

    const busy = await refusalOf(proxiesApi.remove(proxy.id, true));
    expect(busy.code).toBe('proxy_busy');
    expect(sessionOfRefusal(busy)).toMatchObject({
      id: session.id,
      name: 'holder',
      status: 'running',
    });

    await sessionsApi.stop(session.id);
    const inUse = await refusalOf(proxiesApi.remove(proxy.id));
    expect(inUse.code).toBe('proxy_in_use');
    expect(sessionOfRefusal(inUse)).toMatchObject({ name: 'holder' });
    await proxiesApi.remove(proxy.id, true);
  });

  it('lists more rows than the server answers with at once, newest first, none twice', async () => {
    const text = Array.from(
      { length: 520 },
      (_, index) => `10.9.${Math.floor(index / 250)}.${(index % 250) + 1}:8080`,
    ).join('\n');
    const imported = await proxiesApi.import(text, 'http');
    expect(imported.added).toHaveLength(520);

    const all = await proxiesApi.list({ limit: 1000 });
    expect(all.total).toBe(520);
    expect(all.items).toHaveLength(520);
    const ids = all.items.map((proxy) => proxy.id);
    expect(new Set(ids).size).toBe(520);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    const few = await proxiesApi.list({ limit: 3 });
    expect(few.total).toBe(520);
    expect(few.items.map((proxy) => proxy.id)).toEqual(ids.slice(0, 3));
  });
});

describe('the sessions', () => {
  it('runs a session through its life: create, rename, rotate, restart, stop, start, delete', async () => {
    await proxiesApi.import('203.0.113.21:8080\n203.0.113.22:8080', 'http');

    const created = await sessionsApi.create({ name: 'shop', os: 'linux' });
    expect(created).toMatchObject({ name: 'shop' });
    const live = await running(created.id);
    expect(live.proxy).not.toBeNull();
    expect(live.location).not.toBeNull();

    expect(await sessionsApi.rename(created.id, 'shop-eu')).toMatchObject({
      name: 'shop-eu',
    });
    expect((await sessionsApi.checkIp(created.id)).id).toBe(created.id);

    await sessionsApi.rotate(created.id);
    const rotated = await running(created.id);
    expect(rotated.proxy?.display).not.toBe(live.proxy?.display);

    await sessionsApi.restart(created.id);
    await running(created.id);

    await sessionsApi.stop(created.id);
    await expect
      .poll(async () => (await sessionsApi.get(created.id)).status)
      .toBe('stopped');

    await sessionsApi.start(created.id);
    await running(created.id);

    const list = await sessionsApi.list({ limit: 10 });
    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(created.id);

    const exported = await sessionsApi.exportProxies();
    expect(exported.proxies).toHaveLength(1);

    await sessionsApi.remove(created.id);
    expect((await sessionsApi.list({ limit: 10 })).total).toBe(0);
    expect((await refusalOf(sessionsApi.get(created.id))).code).toBe(
      'session_not_found',
    );
  });

  it('says there is no proxy for a new session, with a code the page words', async () => {
    const error = await refusalOf(sessionsApi.create({ name: 'lonely' }));
    expect(error.status).toBe(409);
    expect(error.code).toBe('no_free_proxy');
  });

  it('gives the names and the IP of the running sessions that share an exit IP', async () => {
    await proxiesApi.import('203.0.113.31:8080\n203.0.113.32:8080', 'http');
    const first = await sessionsApi.create({ name: 'first' });
    const second = await sessionsApi.create({ name: 'second' });
    const firstRunning = await running(first.id);
    const secondRunning = await running(second.id);
    await sessionsApi.stop(second.id);
    await expect
      .poll(async () => (await sessionsApi.get(second.id)).status)
      .toBe('stopped');

    // Two proxies that now lead to one exit IP: the sessions would show the
    // same address to every site.
    const shared = firstRunning.proxy?.exitIp;
    const holder = secondRunning.proxy?.display;
    if (shared == null || holder === undefined) throw new Error('no proxy');
    checker.setIp(new URL(holder).host, shared, 'DE');

    const refused = await refusalOf(sessionsApi.start(second.id));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('ip_in_use');
    expect(readSharedIpConflict(refused.extra)).toEqual({
      exitIp: shared,
      names: ['first'],
    });

    await sessionsApi.start(second.id, true);
    await running(second.id);
  });
});

describe('the secrets', () => {
  it('keeps a secret: create, list, read with its masked values, update, delete', async () => {
    const proxies = '203.0.113.41:8080';
    await proxiesApi.import(proxies, 'http');
    const session = await sessionsApi.create({ name: 'vault' });
    await running(session.id);

    const created = await secretsApi.create({
      kind: 'credentials',
      title: 'Shop login',
      sessionId: session.id,
      fields: [
        { label: 'Website', value: 'https://shop.example' },
        { label: 'Username', value: 'jane' },
        { label: 'Password', value: 'hunter2' },
      ],
    });
    expect(created).toMatchObject({ title: 'Shop login', kind: 'credentials' });

    const [summary] = await secretsApi.list({ scope: String(session.id) });
    expect(summary).toMatchObject({
      id: created.id,
      title: 'Shop login',
      session: { id: session.id, name: 'vault' },
    });
    expect(JSON.stringify(summary)).not.toContain('hunter2');

    const read = await secretsApi.get(created.id);
    const password = read.fields.find((field) => field.label === 'Password');
    expect(password).toMatchObject({ hidden: true, value: 'hunter2' });

    const moved = await secretsApi.update(created.id, {
      title: 'Shop',
      sessionId: null,
    });
    expect(moved).toMatchObject({ title: 'Shop', session: null });

    await secretsApi.remove(created.id);
    expect(await secretsApi.list()).toEqual([]);
    expect((await refusalOf(secretsApi.get(created.id))).code).toBe(
      'secret_not_found',
    );
  });

  it('refuses a secret of a kind that does not exist, with a code the page words', async () => {
    const answer = await fetch('/api/secrets?kind=nope');
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({ error: 'invalid_kind' });
  });
});

// The English sentence stays for API and MCP clients; the page words a code in
// the person's language, and the fields the backend names beside the code are
// what lets it say WHY. Both halves are this page's own code, against the
// backend that answers.
describe('the reason behind a coded error', () => {
  const t = i18n.getFixedT('en', 'errors');
  const german = i18n.getFixedT('de', 'errors');

  async function stoppedSession(name: string): Promise<Session> {
    const session = await sessionsApi.create({ name });
    await running(session.id);
    await sessionsApi.stop(session.id);
    await expect
      .poll(async () => (await sessionsApi.get(session.id)).status)
      .toBe('stopped');
    return sessionsApi.get(session.id);
  }

  async function failed(id: number): Promise<Session> {
    let latest: Session | undefined;
    await expect
      .poll(async () => {
        latest = await sessionsApi.get(id);
        return latest.status === 'error';
      })
      .toBe(true);
    if (latest === undefined) throw new Error('no session was read');
    return latest;
  }

  it('says why the proxy of a session does not work: in the refusal and on the session', async () => {
    const cause = 'the proxy rejected the credentials (HTTP 407)';
    const proxy = await proxiesApi.add('203.0.113.51:8080', 'http');
    const session = await stoppedSession('broken');
    checker.setError('203.0.113.51:8080', cause);

    const refused = await refusalOf(sessionsApi.start(session.id));
    expect([refused.status, refused.code]).toEqual([502, 'proxy_unreachable']);
    expect(refused.extra).toEqual({ proxyId: proxy.id, reason: cause });
    expect(refused.message).toContain(cause); // the English sentence is whole
    // The catalog's sentence, with the cause the backend named: the words are the catalog's to change.
    const sentence = t('proxy_unreachable_reason', { reason: cause });
    expect(sentence).toContain(cause);
    expect(failureText(refused, t)).toBe(sentence);
    expect(failureText(refused, german)).toContain(cause);

    // The session shows the same cause, for the row and the card.
    const shown = await sessionsApi.get(session.id);
    expect(shown.errorCode).toBe('proxy_unreachable');
    expect(shown.errorExtra).toEqual({ proxyId: proxy.id, reason: cause });
    expect(sessionFailureText(shown, t)).toBe(sentence);
  });

  it('says why the IP check of a session found its proxy not working', async () => {
    await proxiesApi.add('203.0.113.54:8080', 'http');
    const session = await sessionsApi.create({ name: 'checked' });
    await running(session.id);
    checker.setError('203.0.113.54:8080', 'connection refused');

    const refused = await refusalOf(sessionsApi.checkIp(session.id));
    expect(refused.code).toBe('proxy_unreachable');
    expect(failureText(refused, t)).toBe(
      t('proxy_unreachable_reason', { reason: 'connection refused' }),
    );
    // A check that cannot tell leaves a running session as it is.
    expect((await sessionsApi.get(session.id)).errorExtra).toBeNull();
  });

  it('says how many proxies failed their check when a session could get none', async () => {
    checker.setError('203.0.113.52:8080', 'cannot connect to the proxy');
    const gate = checker.hold();
    await proxiesApi.add('203.0.113.52:8080', 'http');
    // Created while the proxy's first check runs: the assignment waits for it.
    const created = await sessionsApi.create({ name: 'lonely' });
    gate.release();

    const shown = await failed(created.id);
    expect(shown.errorCode).toBe('no_working_proxy');
    expect(shown.errorExtra).toEqual({ failed: 1 });
    expect(shown.error).toContain('1 failed their check'); // the English sentence is whole
    expect(sessionFailureText(shown, t)).toBe(
      'No working proxy is available (1 proxy failed its check). Add proxies or check the existing ones, then try again.',
    );
    expect(sessionFailureText(shown, german)).toContain(
      '(1 Proxy hat die Prüfung nicht bestanden)',
    );
  });

  it('says why the place of an exit IP is not known', async () => {
    const reason = 'the GeoIP database has no location for 203.0.113.53';
    browser.geoByIp.set('203.0.113.53', new GeoLookupError(reason));
    await proxiesApi.add('203.0.113.53:8080', 'http');
    const created = await sessionsApi.create({ name: 'nowhere' });

    const shown = await failed(created.id);
    expect(shown.errorCode).toBe('unknown_ip_location');
    expect(shown.errorExtra).toEqual({ reason });
    expect(shown.error).toContain(reason); // the English sentence is whole
    expect(sessionFailureText(shown, t)).toBe(
      t('unknown_ip_location_reason', { reason }),
    );
  });

  it('says what a session is doing when it cannot be asked for more', async () => {
    await proxiesApi.add('203.0.113.56:8080', 'http');
    const session = await stoppedSession('busy');
    browser.launchGate = new Gate();
    await sessionsApi.start(session.id);

    const refused = await refusalOf(sessionsApi.rotate(session.id));
    expect([refused.status, refused.code]).toEqual([409, 'session_busy']);
    expect(refused.extra).toEqual({ doing: 'starting' });
    expect(failureText(refused, t)).toBe(
      'This session is starting. Try again in a moment.',
    );
    expect(failureText(refused, german)).toBe(
      'Diese Sitzung startet gerade. Versuche es gleich noch einmal.',
    );
    browser.launchGate.open();
    await running(session.id);
  });
});
