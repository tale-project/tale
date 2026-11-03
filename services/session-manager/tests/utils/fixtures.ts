// Typed builders for the objects of the HTTP API, with sensible defaults, so a
// test says only what it is about: `session({ status: 'running' })`.

import type {
  ImportDuplicate,
  ImportLineError,
  ImportResult,
  Meta,
  Proxy,
  ProxyExport,
  Secret,
  SecretSummary,
  Session,
  Settings,
} from '@/lib/api/schemas';

export function meta(
  overrides: Partial<Omit<Meta, 'counts'>> & {
    counts?: Partial<Meta['counts']>;
  } = {},
): Meta {
  const { counts, ...rest } = overrides;
  return {
    version: 'dev',
    browserVersion: '152.0.4-beta.30',
    browserInstalled: true,
    browserInstalling: false,
    browserInstallError: null,
    osOptions: ['random', 'windows', 'macos', 'linux'],
    secretKinds: [
      {
        key: 'personal',
        label: 'Personal information',
        fields: [
          { label: 'Name', hidden: false, multiline: false },
          { label: 'Email', hidden: false, multiline: false },
          { label: 'Phone', hidden: false, multiline: false },
          { label: 'Address', hidden: false, multiline: true },
          { label: 'Company', hidden: false, multiline: false },
          { label: 'Company address', hidden: false, multiline: true },
        ],
      },
      {
        key: 'credentials',
        label: 'Credentials',
        fields: [
          { label: 'Website', hidden: false, multiline: false },
          { label: 'Username', hidden: false, multiline: false },
          { label: 'Password', hidden: true, multiline: false },
        ],
      },
      {
        key: 'card',
        label: 'Credit card',
        fields: [
          { label: 'Cardholder', hidden: false, multiline: false },
          { label: 'Card number', hidden: true, multiline: false },
          { label: 'Expiry', hidden: false, multiline: false },
          { label: 'CVC', hidden: true, multiline: false },
        ],
      },
      {
        key: 'note',
        label: 'Note',
        fields: [{ label: 'Note', hidden: false, multiline: true }],
      },
    ],
    nextSessionName: '0001',
    ...rest,
    counts: {
      proxies: 0,
      freeProxies: 0,
      failedProxies: 0,
      checkingProxies: 0,
      sessions: 0,
      running: 0,
      secrets: 0,
      ...counts,
    },
  };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    startPage: 'https://www.google.com',
    defaultStartPage: 'https://www.google.com',
    mcpEnabled: false,
    ...overrides,
  };
}

export function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    name: '0001',
    os: 'windows',
    status: 'stopped',
    activity: null,
    error: null,
    errorCode: null,
    errorExtra: null,
    proxy: null,
    fingerprint: {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
      platform: 'Win32',
      screen: '1920x1080',
      gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)',
      locale: null,
      timezone: null,
    },
    location: null,
    createdAt: '2026-11-01T10:00:00+00:00',
    lastStartedAt: null,
    ...overrides,
  };
}

/** A session that runs behind a proxy that exits through `203.0.113.7` in Germany. */
export function runningSession(overrides: Partial<Session> = {}): Session {
  return session({
    status: 'running',
    proxy: {
      id: 1,
      display: 'http://198.51.100.4:8080',
      exitIp: '203.0.113.7',
      country: 'DE',
      checkStatus: 'ok',
    },
    location: {
      ip: '203.0.113.7',
      country: 'DE',
      timezone: 'Europe/Berlin',
      latitude: 52.52,
      longitude: 13.405,
      inSync: true,
    },
    ...overrides,
    fingerprint: {
      ...session().fingerprint,
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
      ...overrides.fingerprint,
    },
  });
}

export function proxy(overrides: Partial<Proxy> = {}): Proxy {
  return {
    id: 1,
    scheme: 'http',
    host: '198.51.100.4',
    port: 8080,
    username: null,
    hasPassword: false,
    display: 'http://198.51.100.4:8080',
    createdAt: '2026-11-01T09:00:00+00:00',
    check: {
      status: 'ok',
      ok: true,
      exitIp: '203.0.113.7',
      country: 'DE',
      latencyMs: 240,
      checkedAt: '2026-11-01T09:01:00+00:00',
      error: null,
    },
    session: null,
    sameIpAs: null,
    ...overrides,
  };
}

export function secretSummary(
  overrides: Partial<SecretSummary> = {},
): SecretSummary {
  return {
    id: 1,
    kind: 'credentials',
    title: 'Example login',
    session: null,
    preview: 'example.com · ada',
    updatedAt: '2026-11-01T09:00:00+00:00',
    ...overrides,
  };
}

export function secret(overrides: Partial<Secret> = {}): Secret {
  return {
    ...secretSummary(),
    fields: [
      { label: 'Website', value: 'example.com', hidden: false },
      { label: 'Username', value: 'ada', hidden: false },
      { label: 'Password', value: 'correct horse', hidden: true },
    ],
    createdAt: '2026-11-01T09:00:00+00:00',
    ...overrides,
  };
}

type ProxyCheck = Proxy['check'];
type SessionRef = NonNullable<Proxy['session']>;

/** The session a proxy, a secret or a refusal names: id, name and status. */
export function sessionRef(overrides: Partial<SessionRef> = {}): SessionRef {
  return { id: 1, name: '0001', status: 'stopped', ...overrides };
}

/** The result of a proxy's last check: a working proxy unless told otherwise. */
export function proxyCheck(overrides: Partial<ProxyCheck> = {}): ProxyCheck {
  return {
    status: 'ok',
    ok: true,
    exitIp: '203.0.113.7',
    country: 'DE',
    latencyMs: 240,
    checkedAt: '2026-11-01T09:01:00+00:00',
    error: null,
    ...overrides,
  };
}

/** A line of an import that the server refused. */
export function importError(
  overrides: Partial<ImportLineError> = {},
): ImportLineError {
  return {
    line: 1,
    input: '1.2.3.4:99999:***:***',
    message: 'invalid port 99999 (must be 1-65535)',
    code: 'invalid_port_value',
    params: { port: '99999' },
    ...overrides,
  };
}

/** A line of an import that repeats a proxy the pool has. */
export function importDuplicate(
  overrides: Partial<ImportDuplicate> = {},
): ImportDuplicate {
  return {
    line: 2,
    display: 'http://198.51.100.4:8080',
    existingId: 4,
    ...overrides,
  };
}

/** What an import answers: nothing added, repeated or refused unless told. */
export function importResult(
  overrides: Partial<ImportResult> = {},
): ImportResult {
  return {
    added: [],
    duplicates: [],
    errors: [],
    summary: 'Added 0, 0 duplicates, 0 errors',
    ...overrides,
  };
}

/** The file the proxies export: no proxies and no accounts unless told. */
export function proxyExport(overrides: Partial<ProxyExport> = {}): ProxyExport {
  return {
    exported_at: '2026-11-01T12:00:00Z',
    proxies: [],
    accounts: [],
    ...overrides,
  };
}
