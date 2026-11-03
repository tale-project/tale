import { expect, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';

import {
  importResultSchema,
  metaSchema,
  proxySchema,
  secretSchema,
  secretSummarySchema,
  sessionSchema,
  settingsSchema,
  type ImportResult,
  type Meta,
  type OsChoice,
  type Proxy,
  type Secret,
  type SecretCreate,
  type Session,
  type Settings,
  type SettingsUpdate,
} from '../../../lib/api/schemas';
import { TIMEOUT } from './env';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The most rows the API answers with in one request. */
const PAGE = 500;

/**
 * The session manager's HTTP API, for a spec to set a scene up and read the
 * result back without the page: the page is what a spec tests, so what it
 * needs beforehand is made here, and checked against the same schemas the page
 * parses with.
 */
export class AppApi {
  /** The next documentation address `addProxies` hands out (203.0.113.<n>). */
  #nextHost = 10;

  constructor(private readonly request: APIRequestContext) {}

  async #send(method: Method, path: string, data?: unknown): Promise<unknown> {
    const response = await this.request.fetch(`/api${path}`, { method, data });
    if (!response.ok()) {
      throw new Error(
        `${method} /api${path} answered ${response.status()}: ${await response.text()}`,
      );
    }
    return response.status() === 204 ? null : response.json();
  }

  async #read<S extends z.ZodType>(
    schema: S,
    method: Method,
    path: string,
    data?: unknown,
  ): Promise<z.output<S>> {
    return schema.parse(await this.#send(method, path, data));
  }

  meta(): Promise<Meta> {
    return this.#read(metaSchema, 'GET', '/meta');
  }

  settings(): Promise<Settings> {
    return this.#read(settingsSchema, 'GET', '/settings');
  }

  updateSettings(update: SettingsUpdate): Promise<Settings> {
    return this.#read(settingsSchema, 'PATCH', '/settings', update);
  }

  // -- sessions --------------------------------------------------------------

  sessions(): Promise<Session[]> {
    return this.#read(z.array(sessionSchema), 'GET', `/sessions?limit=${PAGE}`);
  }

  session(id: number): Promise<Session> {
    return this.#read(sessionSchema, 'GET', `/sessions/${id}`);
  }

  /** Creates a session; it starts at once, as it does from the page. */
  createSession(name?: string, os: OsChoice = 'random'): Promise<Session> {
    return this.#read(sessionSchema, 'POST', '/sessions', { name, os });
  }

  /** Creates a session with a proxy of its own and waits until it runs. */
  async startSession(name?: string): Promise<Session> {
    await this.addProxies(1);
    const created = await this.createSession(name);
    return this.waitForStatus(created.id, 'running');
  }

  async waitForStatus(id: number, status: Session['status']): Promise<Session> {
    let latest = await this.session(id);
    await expect
      .poll(
        async () => {
          latest = await this.session(id);
          return latest.status === status && latest.activity === null;
        },
        { timeout: TIMEOUT.BACKGROUND, message: `session ${id} is ${status}` },
      )
      .toBe(true);
    return latest;
  }

  async stopSession(id: number): Promise<Session> {
    const stopped = await this.#read(
      sessionSchema,
      'POST',
      `/sessions/${id}/stop`,
    );
    return stopped.status === 'stopped'
      ? stopped
      : this.waitForStatus(id, 'stopped');
  }

  async deleteSession(id: number): Promise<void> {
    await this.#send('DELETE', `/sessions/${id}`);
  }

  // -- proxies ---------------------------------------------------------------

  async proxies(): Promise<Proxy[]> {
    return this.#read(z.array(proxySchema), 'GET', `/proxies?limit=${PAGE}`);
  }

  importProxies(text: string): Promise<ImportResult> {
    return this.#read(importResultSchema, 'POST', '/proxies/import', {
      text,
      defaultScheme: 'http',
    });
  }

  /**
   * Adds `count` proxies that exit through 203.0.113.<host> (the fake checker's
   * rule), each address new to this run, and waits until they have been checked.
   */
  async addProxies(count: number): Promise<Proxy[]> {
    const lines = Array.from(
      { length: count },
      () => `203.0.113.${this.#nextHost++}:8080`,
    );
    const { added } = await this.importProxies(lines.join('\n'));
    await expect
      .poll(
        async () => {
          const pool = await this.proxies();
          return pool
            .filter((proxy) => added.some((one) => one.id === proxy.id))
            .every((proxy) => proxy.check.status === 'ok');
        },
        { timeout: TIMEOUT.BACKGROUND, message: 'the new proxies are checked' },
      )
      .toBe(true);
    return added;
  }

  async deleteProxy(id: number): Promise<void> {
    await this.#send('DELETE', `/proxies/${id}?force=true`);
  }

  // -- secrets ---------------------------------------------------------------

  secrets() {
    return this.#read(
      z.array(secretSummarySchema),
      'GET',
      `/secrets?scope=all&limit=${PAGE}`,
    );
  }

  createSecret(input: SecretCreate): Promise<Secret> {
    return this.#read(secretSchema, 'POST', '/secrets', input);
  }

  async deleteSecret(id: number): Promise<void> {
    await this.#send('DELETE', `/secrets/${id}`);
  }

  // -- the state between two specs -------------------------------------------

  /**
   * Back to an empty manager with its default settings. A list answers one page
   * at a time (the newest rows): each is emptied until it answers nothing.
   */
  async reset(): Promise<void> {
    for (let rows = await this.sessions(); rows.length > 0;) {
      for (const session of rows) await this.deleteSession(session.id);
      rows = await this.sessions();
    }
    for (let rows = await this.proxies(); rows.length > 0;) {
      for (const proxy of rows) await this.deleteProxy(proxy.id);
      rows = await this.proxies();
    }
    for (let rows = await this.secrets(); rows.length > 0;) {
      for (const secret of rows) await this.deleteSecret(secret.id);
      rows = await this.secrets();
    }
    await this.updateSettings({ startPage: '', mcpEnabled: false });
  }
}
