// A `Manager` for the tests of the MCP tools (the HTTP routes have
// `http-stub-manager.ts`): every method throws unless the test passes its own,
// and the builders make API objects that pass the schemas of
// `lib/api/schemas.ts`.
//
//   const manager = stubManager({ listSessions: () => [sessionFixture()] });
//
// Tests that need the real rules (exclusive proxies, the session lifecycle)
// use the harness with the real manager instead.

import type {
  Meta,
  Proxy,
  Secret,
  SecretSummary,
  Session,
  Settings,
} from '../../lib/api/schemas.ts';
import type { Manager } from '../domains/sessions/manager.ts';
import { DEFAULT_START_PAGE } from '../lib/web-url.ts';

function notStubbed(name: string): () => never {
  return () => {
    throw new Error(
      `The stub manager has no ${name}: pass one in the overrides.`,
    );
  };
}

export function settingsFixture(overrides: Partial<Settings> = {}): Settings {
  return {
    startPage: DEFAULT_START_PAGE,
    defaultStartPage: DEFAULT_START_PAGE,
    mcpEnabled: true,
    ...overrides,
  };
}

export function stubManager(overrides: Partial<Manager> = {}): Manager {
  return {
    meta: notStubbed('meta'),
    settings: () => settingsFixture(),
    updateSettings: notStubbed('updateSettings'),
    listSecrets: notStubbed('listSecrets'),
    getSecret: notStubbed('getSecret'),
    createSecret: notStubbed('createSecret'),
    updateSecret: notStubbed('updateSecret'),
    deleteSecret: notStubbed('deleteSecret'),
    listProxies: notStubbed('listProxies'),
    countProxies: notStubbed('countProxies'),
    proxy: notStubbed('proxy'),
    addProxy: notStubbed('addProxy'),
    importProxies: notStubbed('importProxies'),
    deleteProxy: notStubbed('deleteProxy'),
    checkProxy: notStubbed('checkProxy'),
    checkAllProxies: notStubbed('checkAllProxies'),
    listSessions: notStubbed('listSessions'),
    countSessions: notStubbed('countSessions'),
    session: notStubbed('session'),
    exportProxies: notStubbed('exportProxies'),
    remote: notStubbed('remote'),
    showSession: notStubbed('showSession'),
    typeIntoSession: notStubbed('typeIntoSession'),
    createSession: notStubbed('createSession'),
    renameSession: notStubbed('renameSession'),
    startSession: notStubbed('startSession'),
    stopSession: notStubbed('stopSession'),
    rotateSession: notStubbed('rotateSession'),
    restartSession: notStubbed('restartSession'),
    checkSessionIp: notStubbed('checkSessionIp'),
    deleteSession: notStubbed('deleteSession'),
    recheckRunning: notStubbed('recheckRunning'),
    watchExitIps: notStubbed('watchExitIps'),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

// -- API objects ---------------------------------------------------------------

/** A running session "0001" with a working proxy and a place (New York). */
export function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    name: '0001',
    os: 'windows',
    status: 'running',
    activity: null,
    error: null,
    errorCode: null,
    errorExtra: null,
    proxy: {
      id: 1,
      display: 'http://192.0.2.1:8080',
      exitIp: '203.0.113.1',
      country: 'US',
      checkStatus: 'ok',
    },
    fingerprint: {
      userAgent: 'FakeAgent/1',
      platform: 'Win32',
      screen: '1920x1080',
      gpu: 'Fake GPU',
      locale: 'en-US',
      timezone: 'America/New_York',
    },
    location: {
      ip: '203.0.113.1',
      country: 'US',
      timezone: 'America/New_York',
      latitude: 40.71,
      longitude: -74,
      inSync: true,
    },
    createdAt: '2026-11-01T10:00:00Z',
    lastStartedAt: '2026-11-01T10:05:00Z',
    ...overrides,
  };
}

/** A working proxy that no session has. */
export function proxyFixture(overrides: Partial<Proxy> = {}): Proxy {
  return {
    id: 1,
    scheme: 'http',
    host: '192.0.2.1',
    port: 8080,
    username: null,
    hasPassword: false,
    display: 'http://192.0.2.1:8080',
    createdAt: '2026-11-01T09:00:00Z',
    check: {
      status: 'ok',
      ok: true,
      exitIp: '203.0.113.1',
      country: 'US',
      latencyMs: 120,
      checkedAt: '2026-11-01T09:01:00Z',
      error: null,
    },
    session: null,
    sameIpAs: null,
    ...overrides,
  };
}

/** A credentials secret for every session. */
export function secretFixture(overrides: Partial<Secret> = {}): Secret {
  return {
    id: 1,
    kind: 'credentials',
    title: 'Shop',
    session: null,
    preview: 'me',
    updatedAt: '2026-11-01T10:00:00Z',
    createdAt: '2026-11-01T10:00:00Z',
    fields: [
      { label: 'Username', value: 'me', hidden: false },
      { label: 'Password', value: 'hunter2', hidden: true },
    ],
    ...overrides,
  };
}

/** What a list shows of a secret: the same without its values. */
export function summaryOf(secret: Secret): SecretSummary {
  return {
    id: secret.id,
    kind: secret.kind,
    title: secret.title,
    session: secret.session,
    preview: secret.preview,
    updatedAt: secret.updatedAt,
  };
}

export function metaFixture(overrides: Partial<Meta> = {}): Meta {
  return {
    version: '0.1.0',
    browserVersion: '152.0.4-beta.30',
    browserInstalled: true,
    browserInstalling: false,
    browserInstallProgress: null,
    browserInstallError: null,
    osOptions: ['random', 'windows', 'macos', 'linux'],
    secretKinds: [],
    nextSessionName: '0001',
    counts: {
      proxies: 0,
      freeProxies: 0,
      failedProxies: 0,
      checkingProxies: 0,
      sessions: 0,
      running: 0,
      secrets: 0,
    },
    ...overrides,
  };
}
