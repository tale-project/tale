import { createHash } from 'node:crypto';
import { inspect } from 'node:util';

import he from 'he';
import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../../auth/auth.ts';
import type { SessionBundle } from '../../auth/session.ts';

/**
 * The GitHub App doors and returns (`github-app-routes.ts`) over a recorded
 * database, a scripted GitHub and session cookies: what the hand-off posts
 * [CONN-R34], who may open the doors [CONN-R35], that a round trip completes
 * once for the member who began it [CONN-R36], and that an installation is
 * stored only as the app's own read of it [CONN-R37]. The credential
 * service is mocked where it would write or read a credential; its
 * creatability check runs for real, against the recorded rows.
 */

type Service = typeof import('../connector_credentials/service.ts');

const service = vi.hoisted(() => ({
  createGithubAppCredentialInTransaction:
    vi.fn<Service['createGithubAppCredentialInTransaction']>(),
  findGithubAppCredentialsByInstallation:
    vi.fn<Service['findGithubAppCredentialsByInstallation']>(),
  getCredential: vi.fn<Service['getCredential']>(),
  listGithubAppInstallations: vi.fn<Service['listGithubAppInstallations']>(),
  readGithubAppInstallation: vi.fn<Service['readGithubAppInstallation']>(),
  recordGithubAppInstallationInTransaction:
    vi.fn<Service['recordGithubAppInstallationInTransaction']>(),
}));
vi.mock('../connector_credentials/service.ts', async (importOriginal) => ({
  ...(await importOriginal<Service>()),
  ...service,
}));

import { createApp } from '../../app.ts';
import { findConnector } from '../../core/connector_credentials/connector_catalog.ts';
import type {
  GithubAppFailure,
  GithubAppInstallationInfo,
} from '../../core/connector_credentials/github_app.ts';
import type { FetchLike } from '../../core/http_connectors/token_exchange.ts';
import {
  ConnectorCredentialError,
  type GithubAppInstallationRecord,
  type MaskedCredential,
} from '../connector_credentials/service.ts';
import { GITHUB_APP_HANDOFF_CSP } from './github-app-pages.ts';
import { createConnectorGithubAppRoutes } from './github-app-routes.ts';
import { GITHUB_APP_STATE_TTL_MS } from './github-app.ts';

type InstallationRead = Awaited<
  ReturnType<Service['readGithubAppInstallation']>
>;
type ReadRefusal = Extract<InstallationRead, { ok: false }>['reason'];

// ------------------------------------------------------------------ world

const NOW = Date.parse('2026-11-02T09:00:00Z');
const TTL = GITHUB_APP_STATE_TTL_MS;

/** The registration's code: it buys the app's private key for an hour. */
const CODE = 'c0de5f7a2e9d4b6a8c01';
const KEY_MATERIAL = 'MIIEowIBAAKCAQEAtaleTestKeyMaterialThatNoLogShows';
const PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----\n${KEY_MATERIAL}\n-----END RSA PRIVATE KEY-----\n`;
const CLIENT_SECRET = 'tale-test-client-secret-5b0e7f1c';

const SITE = 'https://tale.example/tale';
const SETTINGS = `${SITE}/dashboard/org-1/settings/connectors`;
const ORG_4_SETTINGS = `${SITE}/dashboard/org-4/settings/connectors`;
const BACK = { href: SETTINGS, text: 'Back to connector settings' };
const TALE = { href: '/tale/dashboard', text: 'Tale' };
const ORG_APP_SETTINGS =
  'https://github.com/organizations/acme/settings/apps/acme-tale';
const ORPHAN_LINK = 'Open the app’s settings on GitHub';
const ORPHAN_UNKNOWN =
  'GitHub may have created the app already. Tale does not hold it, so delete it on GitHub under Developer settings › GitHub Apps in your account’s or organization’s settings.';
const ORPHAN_KNOWN =
  'GitHub created the app “Acme Tale”, but Tale does not hold it. Delete it on GitHub.';
/** A return whose state is gone may replay one that completed: Tale may
 * hold that app, and the note says how to tell. */
const ORPHAN_UNMATCHED =
  'GitHub may have created the app already. If your connector settings show a GitHub App credential for it, Tale holds the app and you can keep it. If not, delete it on GitHub under Developer settings › GitHub Apps in your account’s or organization’s settings.';

/** GitHub's answer to the conversion, secrets included. */
const REGISTERED_APP = {
  id: 4242,
  slug: 'acme-tale',
  node_id: 'A_kwDOAcmeTale',
  owner: { login: 'acme', id: 1, type: 'Organization' },
  name: 'Acme Tale',
  description:
    'Signs the commits, pull requests, reviews and comments Tale makes in your repositories.',
  external_url: SITE,
  html_url: 'https://github.com/apps/acme-tale',
  created_at: '2026-11-02T09:00:00Z',
  updated_at: '2026-11-02T09:00:00Z',
  permissions: { metadata: 'read', contents: 'write' },
  events: [],
  client_id: 'Iv23liAcmeTale',
  client_secret: CLIENT_SECRET,
  webhook_secret: null,
  pem: PRIVATE_KEY,
};
const BOT_USER = { login: 'acme-tale[bot]', id: 999, type: 'Bot' };
const CONVERSION_URL = `https://api.github.com/app-manifests/${CODE}/conversions`;
const BOT_URL = 'https://api.github.com/users/acme-tale%5Bbot%5D';

function member(id: string, name: string): SessionBundle {
  return {
    user: { id: `u-${id}`, email: `${id}@acme.example`, name },
    session: { id: `s-${id}`, activeOrganizationId: 'org-1' },
  };
}

/** Ada owns org-1, is a member of org-3 and an admin of org-4. Noah is an
 * admin of org-1, Lena a member there. */
const ADA = member('ada', 'Ada');
const NOAH = member('noah', 'Noah');
const LENA = member('lena', 'Lena');

/** The same person in a session confined to one organization's realm. */
function confinedTo(
  bundle: SessionBundle,
  organizationId: string,
): SessionBundle {
  return {
    user: bundle.user,
    session: {
      id: `${bundle.session.id}-${organizationId}`,
      activeOrganizationId: organizationId,
      trustedOrganizationId: organizationId,
    },
  };
}

interface MemberRow {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  role: string;
}

const MEMBERS: readonly MemberRow[] = [
  { id: 'm-ada-1', organizationId: 'org-1', userId: 'u-ada', role: 'owner' },
  { id: 'm-ada-3', organizationId: 'org-3', userId: 'u-ada', role: 'member' },
  { id: 'm-ada-4', organizationId: 'org-4', userId: 'u-ada', role: 'admin' },
  { id: 'm-noah-1', organizationId: 'org-1', userId: 'u-noah', role: 'admin' },
  { id: 'm-lena-1', organizationId: 'org-1', userId: 'u-lena', role: 'member' },
];
const ORGANIZATIONS = ['org-1', 'org-2', 'org-3', 'org-4'];

const INSTALLATION: GithubAppInstallationRecord = {
  id: 77,
  account: 'acme',
  accountType: 'Organization',
  repositorySelection: 'selected',
};
const READ: InstallationRead = {
  ok: true,
  appId: 4242,
  installation: INSTALLATION,
  repositories: ['acme/api', 'acme/web'],
  repositoryCount: 2,
};

const GITHUB_APP_CREDENTIAL: MaskedCredential = {
  id: 'cred-1',
  connectorSlug: 'github',
  authMethod: 'github-app',
  name: 'Acme GitHub',
  githubApp: {
    appId: 4242,
    clientId: 'Iv23liAcmeTale',
    slug: 'acme-tale',
    owner: 'acme',
  },
  isDefault: true,
  status: 'needs-reauth',
  createdAt: NOW,
  updatedAt: NOW,
};
/** The same credential once its app is installed on acme. */
const INSTALLED_CREDENTIAL: MaskedCredential = {
  ...GITHUB_APP_CREDENTIAL,
  githubApp: {
    appId: 4242,
    clientId: 'Iv23liAcmeTale',
    slug: 'acme-tale',
    owner: 'acme',
    installation: INSTALLATION,
  },
  status: 'active',
};

/** The installed credential, holding `change` where GitHub answers
 * {@link INSTALLATION}. */
function holding(
  change: Partial<GithubAppInstallationRecord>,
): MaskedCredential {
  return {
    ...INSTALLED_CREDENTIAL,
    githubApp: {
      appId: 4242,
      clientId: 'Iv23liAcmeTale',
      slug: 'acme-tale',
      owner: 'acme',
      installation: { ...INSTALLATION, ...change },
    },
  };
}

/** The app's installation on acme, as the app's own list of them shows it. */
const LISTED: GithubAppInstallationInfo = {
  id: 77,
  appId: 4242,
  account: 'acme',
  accountType: 'Organization',
  repositorySelection: 'selected',
  permissions: { contents: 'write', metadata: 'read' },
  suspended: false,
};

const BEARER_CREDENTIAL: MaskedCredential = {
  id: 'cred-1',
  connectorSlug: 'github',
  authMethod: 'bearer',
  name: 'Acme token',
  maskedPreview: 'ghp_…f00d',
  isDefault: true,
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
};

// ------------------------------------------------------- recorded database

interface Statement {
  readonly text: string;
  readonly values: readonly unknown[];
  readonly inTransaction: boolean;
}

interface StateRow {
  readonly flow: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly credentialId: string | null;
  readonly config: unknown;
  readonly createdAt: number;
  readonly expiresAt: number;
}

interface StoredCredential {
  readonly id: string;
  readonly orgId: string;
  readonly connectorSlug: string;
  readonly name: string;
}

type Query = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>;
type FakeSql = Query & {
  readonly json: (value: unknown) => { readonly sqlJson: unknown };
  readonly unsafe: (text: string) => { readonly sqlUnsafe: string };
};

/** The statements the routes run, whitespace collapsed, `$?` per value. */
const SWEEP = 'DELETE FROM app.connector_github_app_states WHERE state_hash IN';
const INSERT = 'INSERT INTO app.connector_github_app_states';
const CLAIM =
  'DELETE FROM app.connector_github_app_states WHERE state_hash = $? RETURNING';
const LOCK =
  'SELECT "id" FROM "member" WHERE "organizationId" = $? AND "userId" = $? FOR SHARE';
const MEMBER =
  'SELECT "id", "organizationId", "userId", "role" FROM "member" WHERE "organizationId" = $? AND "userId" = $? LIMIT 1';
const ORGANIZATION = 'SELECT "id" FROM "organization" WHERE "id" = $? LIMIT 1';
const MEMBER_ROWS =
  'SELECT "id", "organizationId", "userId", "role" FROM "member" WHERE "userId" = $?';
const CREDENTIALS =
  'SELECT $? FROM app.connector_credentials WHERE org_id = $? AND connector_slug = $?';

function asText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`The test database expected text: ${inspect(value)}`);
  }
  return value;
}

function asNumber(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error(`The test database expected a number: ${inspect(value)}`);
  }
  return value;
}

function jsonOf(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('sqlJson' in value)) {
    throw new Error(`The test database expected JSON: ${inspect(value)}`);
  }
  return value.sqlJson;
}

/** The tables the routes read and write, the statements they ran, and the
 * order things happened in (`events`, shared with GitHub and the mocks). */
function createWorld() {
  const statements: Statement[] = [];
  const events: string[] = [];
  const states = new Map<string, StateRow>();
  const members: MemberRow[] = MEMBERS.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
  }));
  const organizations = new Set(ORGANIZATIONS);
  const credentialRows: StoredCredential[] = [];
  const transactions: FakeSql[] = [];

  const memberOf = (organizationId: string, userId: string) =>
    members.find(
      (row) => row.organizationId === organizationId && row.userId === userId,
    );

  const run = (text: string, values: readonly unknown[]): unknown[] => {
    if (text.startsWith(SWEEP)) {
      const now = asNumber(values[0]);
      let left = asNumber(values[1]);
      for (const [hash, row] of states) {
        if (left > 0 && row.expiresAt < now) {
          states.delete(hash);
          left -= 1;
        }
      }
      return [];
    }
    if (text.startsWith(INSERT)) {
      states.set(asText(values[0]), {
        flow: asText(values[1]),
        organizationId: asText(values[2]),
        userId: asText(values[3]),
        credentialId: values[4] === null ? null : asText(values[4]),
        config: jsonOf(values[5]),
        createdAt: asNumber(values[6]),
        expiresAt: asNumber(values[7]),
      });
      events.push('state');
      return [];
    }
    if (text.startsWith(CLAIM)) {
      events.push('claim');
      const hash = asText(values[0]);
      const row = states.get(hash);
      if (row === undefined) return [];
      states.delete(hash);
      return [
        {
          flow: row.flow,
          organizationId: row.organizationId,
          userId: row.userId,
          credentialId: row.credentialId,
          config: row.config,
          expiresAt: row.expiresAt,
        },
      ];
    }
    if (text === LOCK) {
      events.push('lock');
      const row = memberOf(asText(values[0]), asText(values[1]));
      return row === undefined ? [] : [{ id: row.id }];
    }
    if (text === MEMBER) {
      const row = memberOf(asText(values[0]), asText(values[1]));
      return row === undefined
        ? []
        : [
            {
              id: row.id,
              organizationId: row.organizationId,
              userId: row.userId,
              role: row.role,
            },
          ];
    }
    if (text === ORGANIZATION) {
      const id = asText(values[0]);
      return organizations.has(id) ? [{ id }] : [];
    }
    if (text === MEMBER_ROWS) {
      const userId = asText(values[0]);
      return members
        .filter((row) => row.userId === userId)
        .map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          userId: row.userId,
          role: row.role,
        }));
    }
    if (text === CREDENTIALS) {
      const organizationId = asText(values[1]);
      const connectorSlug = asText(values[2]);
      return credentialRows
        .filter(
          (row) =>
            row.orgId === organizationId && row.connectorSlug === connectorSlug,
        )
        .map((row) => ({ id: row.id, name: row.name }));
    }
    throw new Error(`The test database does not know this statement: ${text}`);
  };

  const make = (inTransaction: boolean): FakeSql => {
    const statement: Query = (strings, ...values) => {
      const text = strings.join('$?').replace(/\s+/g, ' ').trim();
      statements.push({ text, values, inTransaction });
      return Promise.resolve().then(() => run(text, values));
    };
    return Object.assign(statement, {
      json: (value: unknown) => ({ sqlJson: value }),
      unsafe: (unsafeText: string) => ({ sqlUnsafe: unsafeText }),
    });
  };

  const sql = Object.assign(make(false), {
    /** A transaction rolls the state rows back when its work throws. */
    begin: async (
      work: (tx: FakeSql) => Promise<unknown>,
    ): Promise<unknown> => {
      const before = [...states].map(([hash, row]): [string, StateRow] => [
        hash,
        structuredClone(row),
      ]);
      const tx = make(true);
      transactions.push(tx);
      try {
        return await work(tx);
      } catch (error) {
        states.clear();
        for (const [hash, row] of before) states.set(hash, row);
        throw error;
      }
    },
  });

  return {
    sql,
    statements,
    events,
    states,
    credentialRows,
    transactions,
    setRole(userId: string, organizationId: string, role: string): void {
      const row = memberOf(organizationId, userId);
      if (row === undefined) {
        throw new Error(`${userId} is no member of ${organizationId}`);
      }
      row.role = role;
    },
    removeMember(userId: string, organizationId: string): void {
      const index = members.findIndex(
        (row) => row.organizationId === organizationId && row.userId === userId,
      );
      if (index < 0) {
        throw new Error(`${userId} is no member of ${organizationId}`);
      }
      members.splice(index, 1);
    },
  };
}

// --------------------------------------------------------- scripted GitHub

function answer(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type':
        typeof body === 'string'
          ? 'text/html; charset=utf-8'
          : 'application/json; charset=utf-8',
    },
  });
}

type Answer = Response | Promise<Response>;

/** GitHub's API as the routes call it: the conversion of a registration's
 * code and the read of the app's bot user. Anything else is a 404. */
function createGithub(events: string[]) {
  const calls: { method: string; url: string }[] = [];
  const handlers: {
    conversion: (code: string) => Answer;
    bot: () => Answer;
  } = {
    conversion: () => answer(201, REGISTERED_APP),
    bot: () => answer(200, BOT_USER),
  };
  const fetchImpl = vi.fn<FetchLike>(async (input, init) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url: input });
    const conversion =
      /^https:\/\/api\.github\.com\/app-manifests\/([^/]+)\/conversions$/.exec(
        input,
      );
    if (method === 'POST' && conversion !== null) {
      events.push('convert');
      return handlers.conversion(decodeURIComponent(conversion[1] ?? ''));
    }
    if (method === 'GET' && input === BOT_URL) {
      events.push('bot');
      return handlers.bot();
    }
    return answer(404, { message: 'Not Found' });
  });
  return { calls, handlers, fetchImpl };
}

// -------------------------------------------------------------- the browser

type Params = Readonly<Record<string, string | undefined>>;

interface Browser {
  /** Whose session cookie the browser sends — Ada's unless named; null for
   * none. */
  readonly as?: SessionBundle | null;
  /** The `Sec-Fetch-Site` it sends; null for none. */
  readonly site?: string | null;
  readonly language?: string;
}

interface Visit extends Browser {
  /** Query parameters added to (or, as undefined, removed from) the URL. */
  readonly params?: Params;
}

let world: ReturnType<typeof createWorld>;
let github: ReturnType<typeof createGithub>;
let sessions: Map<string, SessionBundle>;
let auth: Auth;
let app: ReturnType<typeof createConnectorGithubAppRoutes>;
let logs: { level: string; text: string }[];
/** Every state token a door handed to GitHub. */
let issued: string[];
/** What a test adds to the texts no log may hold. */
let secrets: string[];

/** Better Auth as the routes read it: a session per cookie. */
function fakeAuth(): Auth {
  const fake = {
    api: {
      getSession: async ({
        headers,
      }: {
        headers: Headers;
      }): Promise<SessionBundle | null> => {
        const id = /(?:^|;\s*)tale\.session=([^;]+)/.exec(
          headers.get('cookie') ?? '',
        )?.[1];
        return id === undefined ? null : (sessions.get(id) ?? null);
      },
    },
    resolveSessionAuthority: async (bundle: SessionBundle) => bundle,
    options: { baseURL: SITE },
    handler: async () => new Response(null, { status: 404 }),
  };
  return fake as unknown as Auth;
}

function headersOf(
  browser: Browser,
  defaultSite: string,
): Record<string, string> {
  const as = browser.as === undefined ? ADA : browser.as;
  const site = browser.site === undefined ? defaultSite : browser.site;
  if (as !== null) sessions.set(as.session.id, as);
  return {
    ...(as !== null && { cookie: `tale.session=${as.session.id}` }),
    ...(site !== null && { 'sec-fetch-site': site }),
    ...(browser.language !== undefined && {
      'accept-language': browser.language,
    }),
  };
}

function query(params: Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

const REGISTRATION: Params = {
  organizationId: 'org-1',
  connectorSlug: 'github',
  credentialName: 'Acme GitHub',
  appName: 'Acme Tale',
  owner: 'acme',
};

/** Ada opens the register door from her connector settings. */
function openRegister(params: Params = {}, browser: Browser = {}) {
  return app.request(`/register${query({ ...REGISTRATION, ...params })}`, {
    headers: headersOf(browser, 'same-origin'),
  });
}

/** Ada opens the install door of credential cred-1 from her settings. */
function openInstall(params: Params = {}, browser: Browser = {}) {
  return app.request(
    `/install${query({ organizationId: 'org-1', credentialId: 'cred-1', ...params })}`,
    { headers: headersOf(browser, 'same-origin') },
  );
}

/** GitHub sends the browser back from the registration, with its code. */
function returnFromRegistration(state: string | undefined, visit: Visit = {}) {
  return app.request(
    `/registered${query({ code: CODE, state, ...visit.params })}`,
    { headers: headersOf(visit, 'cross-site') },
  );
}

/** GitHub sends the browser back from the installation page. */
function returnFromInstallation(state: string | undefined, visit: Visit = {}) {
  return app.request(
    `/installed${query({ installation_id: '77', setup_action: 'install', state, ...visit.params })}`,
    { headers: headersOf(visit, 'cross-site') },
  );
}

function stateIn(url: string): string {
  const state = new URL(url).searchParams.get('state');
  if (state === null) throw new Error(`No state in ${url}`);
  issued.push(state);
  return state;
}

/** The registration's state, from the hand-off Ada's door answered. */
async function beginRegistration(
  params: Params = {},
  browser: Browser = {},
): Promise<string> {
  const response = await openRegister(params, browser);
  expect(response.status).toBe(200);
  return stateIn(handoffOf(await response.text()).action);
}

/** The installation's state, from the redirect Ada's door answered. */
async function beginInstallation(): Promise<string> {
  const response = await openInstall();
  expect(response.status).toBe(302);
  return stateIn(response.headers.get('location') ?? '');
}

/** The manifest form of a hand-off page. */
function handoffOf(html: string): {
  action: string;
  manifest: unknown;
  scripts: string[];
} {
  const action =
    /<form id="github-app-manifest" method="post" action="([^"]*)">/.exec(
      html,
    )?.[1];
  const manifest = /<input type="hidden" name="manifest" value="([^"]*)">/.exec(
    html,
  )?.[1];
  if (action === undefined || manifest === undefined) {
    throw new Error(`No manifest form in ${html}`);
  }
  const parsed: unknown = JSON.parse(he.decode(manifest));
  return {
    action: he.decode(action),
    manifest: parsed,
    scripts: [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1] ?? '',
    ),
  };
}

/** An outcome page as a reader sees it: its heading, its text, its links
 * (the last one leads back). */
function readPage(html: string) {
  const heading = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '';
  const main = /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
  const links = [...main.matchAll(/<a href="([^"]*)">([\s\S]*?)<\/a>/g)].map(
    (match) => ({
      href: he.decode(match[1] ?? ''),
      text: he.decode(match[2] ?? ''),
    }),
  );
  return {
    heading: he.decode(heading),
    text: he
      .decode(main.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim(),
    links,
    back: links.at(-1),
  };
}

function headerValues(
  response: Response,
  names: readonly string[],
): Record<string, string | null> {
  return Object.fromEntries(
    names.map((name) => [name, response.headers.get(name)]),
  );
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** What the github connector's `github-app` entry asks of an app. */
function githubAppPermissions(): Record<string, 'read' | 'write'> {
  const entry = findConnector('github')?.auth.find(
    (method) => method.method === 'github-app',
  );
  if (entry?.method !== 'github-app') {
    throw new Error('The github connector takes no GitHub App');
  }
  return { ...entry.permissions };
}

function warnings(): string[] {
  return logs.filter((log) => log.level === 'warn').map((log) => log.text);
}

function errors(): string[] {
  return logs.filter((log) => log.level === 'error').map((log) => log.text);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SITE_URL', 'https://tale.example');
  vi.stubEnv('ADDITIONAL_SITE_URLS', '');
  vi.stubEnv('BASE_PATH', '/tale');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  sessions = new Map();
  issued = [];
  secrets = [];
  logs = [];
  for (const level of ['debug', 'error', 'info', 'log', 'warn'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push({
        level,
        text: args
          .map((arg) => (typeof arg === 'string' ? arg : inspect(arg)))
          .join(' '),
      });
    });
  }
  world = createWorld();
  github = createGithub(world.events);
  auth = fakeAuth();
  app = createConnectorGithubAppRoutes({
    sql: world.sql as unknown as Sql,
    auth,
    fetchImpl: github.fetchImpl,
  });
  service.createGithubAppCredentialInTransaction.mockImplementation(
    async () => {
      world.events.push('create');
      return { credentialId: 'cred-1' };
    },
  );
  service.getCredential.mockResolvedValue(GITHUB_APP_CREDENTIAL);
  service.listGithubAppInstallations.mockImplementation(async () => {
    world.events.push('list');
    return { ok: true, value: [] };
  });
  service.readGithubAppInstallation.mockImplementation(async () => {
    world.events.push('read');
    return READ;
  });
  service.recordGithubAppInstallationInTransaction.mockImplementation(
    async () => {
      world.events.push('record');
      return { changed: true };
    },
  );
  service.findGithubAppCredentialsByInstallation.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Whatever a test did: no log holds the code, the key, GitHub's secrets or
  // a state token.
  const logged = logs.map((log) => log.text).join('\n');
  for (const secret of [
    CODE,
    encodeURIComponent(CODE),
    KEY_MATERIAL,
    CLIENT_SECRET,
    ...secrets,
    ...issued,
  ]) {
    expect(logged).not.toContain(secret);
  }
});

// ------------------------------------------------------------------ tests

describe('the hand-off to GitHub', () => {
  it("posts a private app asking for exactly the connector's permissions, its webhook off [CONN-R34]", async () => {
    const response = await openRegister();
    expect(response.status).toBe(200);
    const handoff = handoffOf(await response.text());
    const state = stateIn(handoff.action);
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(handoff.action).toBe(
      `https://github.com/organizations/acme/settings/apps/new?state=${state}`,
    );
    expect(handoff.manifest).toStrictEqual({
      name: 'Acme Tale',
      url: SITE,
      description:
        'Signs the commits, pull requests, reviews and comments Tale makes in your repositories.',
      public: false,
      redirect_url: `${SITE}/api/connectors/github-app/registered`,
      setup_url: `${SITE}/api/connectors/github-app/installed`,
      setup_on_update: true,
      request_oauth_on_install: false,
      hook_attributes: { url: SITE, active: false },
      default_permissions: githubAppPermissions(),
    });
    expect(github.calls).toEqual([]);
  });

  it.each([
    ['no GitHub organization', undefined],
    ['a blank GitHub organization', '   '],
  ])(
    "registers on the admin's own account for %s [CONN-R34]",
    async (_name, owner) => {
      const response = await openRegister({ owner });
      expect(response.status).toBe(200);
      const { action } = handoffOf(await response.text());
      const state = stateIn(action);
      expect(action).toBe(
        `https://github.com/settings/apps/new?state=${state}`,
      );
      expect(world.states.get(sha256(state))?.config).toStrictEqual({
        connectorSlug: 'github',
        credentialName: 'Acme GitHub',
        appName: 'Acme Tale',
      });
    },
  );

  it('answers the hand-off under its own policy: one hashed script, a form to GitHub alone [CONN-R34]', async () => {
    const response = await openRegister();
    const html = await response.text();
    const { scripts } = handoffOf(html);
    expect(scripts).toHaveLength(1);
    const hash = createHash('sha256')
      .update(scripts[0] ?? '')
      .digest('base64');
    const policy = `default-src 'none'; form-action https://github.com; script-src 'sha256-${hash}'; base-uri 'none'; frame-ancestors 'none'`;
    expect(GITHUB_APP_HANDOFF_CSP).toBe(policy);
    expect(
      headerValues(response, [
        'cache-control',
        'content-language',
        'content-security-policy',
        'content-type',
        'vary',
        'x-content-type-options',
      ]),
    ).toStrictEqual({
      'cache-control': 'no-store',
      'content-language': 'en',
      'content-security-policy': policy,
      'content-type': 'text/html; charset=utf-8',
      vary: 'Accept-Language, Cookie',
      'x-content-type-options': 'nosniff',
    });
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/\b(?:src|href)=/);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<button type="submit">Continue to GitHub</button>');
  });

  it('carries an app name as text, on the page and in the manifest [CONN-R34]', async () => {
    const appName = 'Acme <i>&</i> $& "x"';
    const response = await openRegister({ appName });
    const html = await response.text();
    expect(html).not.toContain('<i>');
    expect(readPage(html).text).toContain(`register the app “${appName}”`);
    expect(handoffOf(html).manifest).toMatchObject({ name: appName });
  });

  it('accepts an app name of 34 characters, however many bytes [CONN-R34]', async () => {
    const appName = '🐙'.repeat(34);
    const response = await openRegister({ appName });
    expect(response.status).toBe(200);
    expect(handoffOf(await response.text()).manifest).toMatchObject({
      name: appName,
    });
  });

  it.each([
    ['a blank app name', { appName: '   ' }],
    ['an app name of 35 characters', { appName: 'a'.repeat(35) }],
    ['a control character in the app name', { appName: 'Acme\u0007Tale' }],
    ['a GitHub organization that is no login', { owner: '-acme' }],
    ['a GitHub organization with a path', { owner: 'acme/evil' }],
  ])(
    'sends nothing to GitHub for %s [CONN-R34]',
    async (_name, params: Params) => {
      const response = await openRegister(params);
      expect(response.status).toBe(400);
      const page = readPage(await response.text());
      expect(page.heading).toBe('These details cannot register a GitHub App');
      expect(page.back).toStrictEqual(BACK);
      expect(world.states.size).toBe(0);
      expect(github.calls).toEqual([]);
    },
  );

  const NOT_CREATABLE: [string, Params, number, string, string][] = [
    [
      'a name the connector already holds',
      { credentialName: 'acme github' },
      409,
      'Reason: A credential named "Acme GitHub" already exists for this connector — pick a different name.',
      'CREDENTIAL_NAME_TAKEN',
    ],
    [
      'a connector without GitHub Apps',
      { connectorSlug: 'slack' },
      400,
      'Reason: Connector "slack" does not accept github-app credentials',
      'AUTH_METHOD_NOT_SUPPORTED',
    ],
    [
      'an unknown connector',
      { connectorSlug: 'nope' },
      404,
      'Reason: Unknown connector "nope"',
      'CONNECTOR_UNKNOWN',
    ],
    [
      'a blank credential name',
      { credentialName: '   ' },
      400,
      'Reason: Credential name must be 1..100 characters.',
      'CREDENTIAL_NAME_INVALID',
    ],
  ];

  it.each(NOT_CREATABLE)(
    'registers no app for %s [CONN-R34]',
    async (_name, params, status, reason, code) => {
      world.credentialRows.push({
        id: 'cred-0',
        orgId: 'org-1',
        connectorSlug: 'github',
        name: 'Acme GitHub',
      });
      const response = await openRegister(params);
      expect(response.status).toBe(status);
      const page = readPage(await response.text());
      expect(page.heading).toBe('This GitHub App cannot be registered');
      expect(page.text).toContain(reason);
      expect(page.back).toStrictEqual(BACK);
      expect(world.states.size).toBe(0);
      expect(github.calls).toEqual([]);
      expect(warnings()).toStrictEqual([
        `[connectors:github-app] refused a "${params.connectorSlug ?? 'github'}" registration for organization org-1: ${code}`,
      ]);
    },
  );

  it('sends nothing to GitHub while the deployment has no public address [CONN-R34]', async () => {
    vi.stubEnv('SITE_URL', '');
    const response = await openRegister();
    expect(response.status).toBe(503);
    const page = readPage(await response.text());
    expect(page.heading).toBe('Tale’s public address is not set');
    expect(page.back).toStrictEqual({
      href: '/tale/dashboard/org-1/settings/connectors',
      text: 'Back to connector settings',
    });
    expect(world.states.size).toBe(0);
    expect(github.calls).toEqual([]);
  });

  it.each([
    ['no organization', { organizationId: undefined }, TALE],
    ['no connector', { connectorSlug: undefined }, BACK],
  ])(
    'reads nothing for a register link with %s',
    async (_name, params: Params, back) => {
      const response = await openRegister(params);
      expect(response.status).toBe(400);
      const page = readPage(await response.text());
      expect(page.heading).toBe('This GitHub App cannot be registered');
      expect(page.back).toStrictEqual(back);
      expect(world.statements).toEqual([]);
    },
  );
});

describe('who registers and installs', () => {
  it.each(['member', 'developer', 'editor'])(
    'refuses a %s at both doors [CONN-R35]',
    async (role) => {
      world.setRole('u-ada', 'org-1', role);
      for (const response of [await openRegister(), await openInstall()]) {
        expect(response.status).toBe(403);
        expect(
          headerValues(response, ['content-type', 'cache-control', 'vary']),
        ).toStrictEqual({
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          vary: 'Cookie',
        });
        expect(await response.text()).toBe(
          'Only organization admins can register or install a GitHub App.',
        );
      }
      expect(world.states.size).toBe(0);
      expect(service.getCredential).not.toHaveBeenCalled();
      expect(service.listGithubAppInstallations).not.toHaveBeenCalled();
      expect(github.calls).toEqual([]);
    },
  );

  const NOT_MEMBERS: [string, string, () => void][] = [
    [
      'a disabled member',
      'org-1',
      () => world.setRole('u-ada', 'org-1', 'disabled'),
    ],
    ['a member of another organization', 'org-2', () => undefined],
    ['an organization that does not exist', 'org-9', () => undefined],
  ];

  it.each(NOT_MEMBERS)(
    'answers %s like any stranger [CONN-R35]',
    async (_name, organizationId, arrange) => {
      arrange();
      for (const response of [
        await openRegister({ organizationId }),
        await openInstall({ organizationId }),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.text()).toBe(
          'You do not have access to this organization.',
        );
      }
      expect(world.states.size).toBe(0);
      expect(service.getCredential).not.toHaveBeenCalled();
    },
  );

  it("refuses a session confined to another organization's realm before reading anything [CONN-R35]", async () => {
    const confined = confinedTo(ADA, 'org-4');
    for (const response of [
      await openRegister({}, { as: confined }),
      await openInstall({}, { as: confined }),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.text()).toBe(
        'You do not have access to this organization.',
      );
    }
    expect(world.statements).toEqual([]);
  });

  it('refuses both doors opened from another site [CONN-R35]', async () => {
    for (const response of [
      await openRegister({}, { site: 'cross-site' }),
      await openInstall({}, { site: 'cross-site' }),
    ]) {
      expect(response.status).toBe(403);
      const page = readPage(await response.text());
      expect(page.heading).toBe('Start this in Tale');
      expect(page.back).toStrictEqual(BACK);
    }
    expect(world.states.size).toBe(0);
    expect(service.getCredential).not.toHaveBeenCalled();
    expect(github.calls).toEqual([]);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused a "github" registration opened from another site (organization org-1)',
      '[connectors:github-app] refused an installation opened from another site (organization org-1)',
    ]);
  });

  it.each(['same-origin', 'same-site', 'none', null])(
    'opens both doors for an admin whose browser says %s [CONN-R35]',
    async (site) => {
      expect((await openRegister({}, { site })).status).toBe(200);
      expect((await openInstall({}, { site })).status).toBe(302);
    },
  );

  it('answers a browser without a session as the session gate does', async () => {
    for (const response of [
      await openRegister({}, { as: null }),
      await openInstall({}, { as: null }),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
    }
    expect(world.statements).toEqual([]);
  });

  it('stores no app for a member demoted while on GitHub, and says where to delete it [CONN-R35]', async () => {
    const state = await beginRegistration();
    world.setRole('u-ada', 'org-1', 'member');
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(403);
    const page = readPage(await response.text());
    expect(page.heading).toBe('Only an admin can finish this');
    expect(page.text).toContain(ORPHAN_UNKNOWN);
    expect(page.links).toStrictEqual([TALE]);
    expect(github.calls).toEqual([]);
    expect(
      service.createGithubAppCredentialInTransaction,
    ).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused a registration return: the member is no longer an admin of organization org-1',
    ]);
  });

  it('stores no installation for a member demoted while on GitHub [CONN-R35]', async () => {
    const state = await beginInstallation();
    world.setRole('u-ada', 'org-1', 'editor');
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(403);
    const page = readPage(await response.text());
    expect(page.heading).toBe('Only an admin can finish this');
    expect(page.links).toStrictEqual([TALE]);
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused an installation return: the member is no longer an admin of organization org-1',
    ]);
  });

  it('repeats the admin check under the membership lock before storing the app [CONN-R35]', async () => {
    github.handlers.conversion = () => {
      world.setRole('u-ada', 'org-1', 'member');
      return answer(201, REGISTERED_APP);
    };
    const state = await beginRegistration();
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(403);
    const page = readPage(await response.text());
    expect(page.heading).toBe('Only an admin can finish this');
    expect(page.text).toContain(ORPHAN_KNOWN);
    expect(page.links).toStrictEqual([
      { href: ORG_APP_SETTINGS, text: ORPHAN_LINK },
      TALE,
    ]);
    expect(world.events).toStrictEqual([
      'state',
      'claim',
      'convert',
      'bot',
      'lock',
    ]);
    expect(
      service.createGithubAppCredentialInTransaction,
    ).not.toHaveBeenCalled();
    expect(world.states.size).toBe(0);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] did not store the app "acme-tale": the member is no longer an admin of organization org-1',
    ]);
  });

  it('repeats the admin check under the membership lock before storing an installation [CONN-R35]', async () => {
    service.readGithubAppInstallation.mockImplementation(async () => {
      world.events.push('read');
      world.removeMember('u-ada', 'org-1');
      return READ;
    });
    const state = await beginInstallation();
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(403);
    expect(readPage(await response.text()).links).toStrictEqual([TALE]);
    expect(world.events).toStrictEqual([
      'list',
      'state',
      'claim',
      'read',
      'lock',
    ]);
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] did not store installation 77: the member is no longer an admin of organization org-1',
    ]);
  });
});

describe('a round trip completes once, for the member who began it', () => {
  it('keeps only the hash of the state, for fifteen minutes [CONN-R36]', async () => {
    const state = await beginRegistration();
    expect(TTL).toBe(15 * 60 * 1000);
    expect([...world.states]).toStrictEqual([
      [
        sha256(state),
        {
          flow: 'register',
          organizationId: 'org-1',
          userId: 'u-ada',
          credentialId: null,
          config: {
            connectorSlug: 'github',
            credentialName: 'Acme GitHub',
            appName: 'Acme Tale',
            owner: 'acme',
          },
          createdAt: NOW,
          expiresAt: NOW + TTL,
        },
      ],
    ]);
    expect(JSON.stringify(world.statements)).not.toContain(state);
    expect(
      world.statements.find((statement) => statement.text.startsWith(SWEEP))
        ?.values,
    ).toStrictEqual([NOW, 25]);
  });

  it('stores what the door fixed, whatever the return adds, and sends Ada on to install [CONN-R36]', async () => {
    const state = await beginRegistration();
    const response = await returnFromRegistration(state, {
      params: {
        organizationId: 'org-4',
        connectorSlug: 'slack',
        credentialName: 'Evil',
        owner: 'evil',
        installation_id: '5',
      },
    });
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    const installState = stateIn(location);
    expect(location).toBe(
      `https://github.com/apps/acme-tale/installations/new?state=${installState}`,
    );
    expect(headerValues(response, ['cache-control', 'vary'])).toStrictEqual({
      'cache-control': 'no-store',
      vary: 'Cookie',
    });
    expect(
      service.createGithubAppCredentialInTransaction,
    ).toHaveBeenCalledExactlyOnceWith(world.transactions[0], {
      organizationId: 'org-1',
      connectorSlug: 'github',
      name: 'Acme GitHub',
      app: {
        appId: 4242,
        clientId: 'Iv23liAcmeTale',
        slug: 'acme-tale',
        privateKey: PRIVATE_KEY,
        owner: 'acme',
        botId: 999,
      },
      createdBy: 'u-ada',
      actor: { userId: 'u-ada', email: 'ada@acme.example' },
    });
    expect(github.calls).toStrictEqual([
      { method: 'POST', url: CONVERSION_URL },
      { method: 'GET', url: BOT_URL },
    ]);
    expect(world.events).toStrictEqual([
      'state',
      'claim',
      'convert',
      'bot',
      'lock',
      'create',
      'state',
    ]);
    expect(
      world.statements
        .filter((statement) => statement.text.startsWith(INSERT))
        .map((statement) => statement.inTransaction),
    ).toStrictEqual([false, true]);
    expect([...world.states]).toStrictEqual([
      [
        sha256(installState),
        {
          flow: 'install',
          organizationId: 'org-1',
          userId: 'u-ada',
          credentialId: 'cred-1',
          config: { connectorSlug: 'github' },
          createdAt: NOW,
          expiresAt: NOW + TTL,
        },
      ],
    ]);
  });

  it('refuses a registration return replayed, and tells how to see whether Tale holds the app [CONN-R36]', async () => {
    const state = await beginRegistration();
    expect((await returnFromRegistration(state)).status).toBe(302);
    const replay = await returnFromRegistration(state);
    expect(replay.status).toBe(400);
    const page = readPage(await replay.text());
    expect(page.heading).toBe('This registration link has expired');
    // Tale holds this app: the note may not say it does not.
    expect(page.text).toContain(ORPHAN_UNMATCHED);
    expect(page.text).not.toContain('Tale does not hold it');
    expect(page.back).toStrictEqual(BACK);
    expect(github.calls.filter((call) => call.method === 'POST')).toHaveLength(
      1,
    );
    expect(
      service.createGithubAppCredentialInTransaction,
    ).toHaveBeenCalledOnce();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused a registration return: its state is unknown',
    ]);
  });

  it('completes a registration returning a moment before fifteen minutes [CONN-R36]', async () => {
    const state = await beginRegistration();
    vi.setSystemTime(NOW + TTL - 1);
    expect((await returnFromRegistration(state)).status).toBe(302);
  });

  it('refuses a registration returning after fifteen minutes [CONN-R36]', async () => {
    const state = await beginRegistration();
    vi.setSystemTime(NOW + TTL);
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(400);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This registration link has expired');
    expect(page.text).toContain(ORPHAN_UNMATCHED);
    expect(github.calls).toEqual([]);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused a registration return: its state is expired',
    ]);
  });

  it('completes an installation returning a moment before fifteen minutes [CONN-R36]', async () => {
    const state = await beginInstallation();
    vi.setSystemTime(NOW + TTL - 1);
    expect((await returnFromInstallation(state)).status).toBe(302);
  });

  it('refuses an installation returning after fifteen minutes [CONN-R36]', async () => {
    const state = await beginInstallation();
    vi.setSystemTime(NOW + TTL);
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(400);
    expect(readPage(await response.text()).heading).toBe(
      'This installation link has expired',
    );
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused an installation return: its state is expired',
    ]);
  });

  it("refuses Noah completing Ada's registration, and spends it [CONN-R36]", async () => {
    const state = await beginRegistration();
    const response = await returnFromRegistration(state, { as: NOAH });
    expect(response.status).toBe(400);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This registration link has expired');
    expect(page.text).toContain(ORPHAN_UNMATCHED);
    expect(page.back).toStrictEqual(BACK);
    expect(github.calls).toEqual([]);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused a registration return completed by another member or realm than the one who started it (organization org-1)',
    ]);
    expect((await returnFromRegistration(state)).status).toBe(400);
    expect(
      service.createGithubAppCredentialInTransaction,
    ).not.toHaveBeenCalled();
    expect(world.states.size).toBe(0);
  });

  const STRANGE_SESSIONS: [
    string,
    SessionBundle | null,
    { href: string; text: string },
    string,
  ][] = [
    ['no session', null, TALE, 'no session'],
    [
      "Ada's session confined to another organization",
      confinedTo(ADA, 'org-4'),
      { href: ORG_4_SETTINGS, text: 'Back to connector settings' },
      'another member or realm',
    ],
  ];

  it.each(STRANGE_SESSIONS)(
    'refuses a registration return with %s [CONN-R36]',
    async (_name, as, back, completer) => {
      const state = await beginRegistration();
      const response = await returnFromRegistration(state, { as });
      expect(response.status).toBe(400);
      expect(readPage(await response.text()).back).toStrictEqual(back);
      expect(github.calls).toEqual([]);
      expect(warnings()).toStrictEqual([
        `[connectors:github-app] refused a registration return completed by ${completer} than the one who started it (organization org-1)`,
      ]);
    },
  );

  const UNKNOWN_STATES: [string, string | undefined][] = [
    ['a forged state', 'forged-state'],
    ['no state', undefined],
    ['an overlong state', 'x'.repeat(257)],
  ];

  it.each(UNKNOWN_STATES)(
    'refuses a registration return with %s, and says GitHub may hold the app [CONN-R36]',
    async (_name, state) => {
      const response = await returnFromRegistration(state);
      expect(response.status).toBe(400);
      const page = readPage(await response.text());
      expect(page.heading).toBe('This registration link has expired');
      expect(page.text).toContain(ORPHAN_UNMATCHED);
      expect(page.back).toStrictEqual(BACK);
      expect(github.calls).toEqual([]);
      expect(warnings()).toStrictEqual([
        '[connectors:github-app] refused a registration return: its state is unknown',
      ]);
    },
  );

  it('mentions no app on GitHub for a registration return without a code', async () => {
    const response = await returnFromRegistration('forged-state', {
      params: { code: undefined },
    });
    expect(response.status).toBe(400);
    expect(readPage(await response.text()).text).not.toContain(
      'GitHub may have created the app',
    );
  });

  it("burns an installation's state brought to the registration return [CONN-R36]", async () => {
    const state = await beginInstallation();
    const registered = await returnFromRegistration(state);
    expect(registered.status).toBe(400);
    expect(readPage(await registered.text()).heading).toBe(
      'This registration link has expired',
    );
    const installed = await returnFromInstallation(state);
    expect(installed.status).toBe(400);
    expect(readPage(await installed.text()).heading).toBe(
      'This installation link has expired',
    );
    expect(github.calls).toEqual([]);
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
  });

  it('fixes the organization, the member and the credential at the install door [CONN-R36]', async () => {
    const response = await openInstall();
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    const state = stateIn(location);
    expect(location).toBe(
      `https://github.com/apps/acme-tale/installations/new?state=${state}`,
    );
    expect(headerValues(response, ['cache-control', 'vary'])).toStrictEqual({
      'cache-control': 'no-store',
      vary: 'Cookie',
    });
    expect(service.getCredential).toHaveBeenCalledExactlyOnceWith(
      world.sql,
      'org-1',
      'cred-1',
    );
    expect([...world.states]).toStrictEqual([
      [
        sha256(state),
        {
          flow: 'install',
          organizationId: 'org-1',
          userId: 'u-ada',
          credentialId: 'cred-1',
          config: { connectorSlug: 'github' },
          createdAt: NOW,
          expiresAt: NOW + TTL,
        },
      ],
    ]);
  });

  it("lets nothing in an installation return's URL move what it stores [CONN-R36]", async () => {
    const state = await beginInstallation();
    const response = await returnFromInstallation(state, {
      params: {
        organizationId: 'org-4',
        credentialId: 'cred-4',
        connectorSlug: 'slack',
      },
    });
    expect(response.headers.get('location')).toBe(
      `${SETTINGS}?connected=github`,
    );
    expect(service.readGithubAppInstallation).toHaveBeenCalledExactlyOnceWith(
      world.sql,
      {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        installationId: 77,
        fetchImpl: github.fetchImpl,
      },
    );
    expect(
      service.recordGithubAppInstallationInTransaction.mock.calls[0]?.[1],
    ).toMatchObject({ organizationId: 'org-1', credentialId: 'cred-1' });
  });

  it('refuses an installation return replayed [CONN-R36]', async () => {
    const state = await beginInstallation();
    expect((await returnFromInstallation(state)).status).toBe(302);
    const replay = await returnFromInstallation(state);
    expect(replay.status).toBe(400);
    expect(readPage(await replay.text()).heading).toBe(
      'This installation link has expired',
    );
    expect(service.readGithubAppInstallation).toHaveBeenCalledOnce();
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).toHaveBeenCalledOnce();
  });

  it("refuses Noah completing Ada's installation, and spends it [CONN-R36]", async () => {
    const state = await beginInstallation();
    const response = await returnFromInstallation(state, { as: NOAH });
    expect(response.status).toBe(400);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This installation link has expired');
    expect(page.back).toStrictEqual(BACK);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused an installation return completed by another member or realm than the one who started it (organization org-1)',
    ]);
    expect((await returnFromInstallation(state)).status).toBe(400);
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
  });

  it('spends an installation that waits for approval, storing nothing [CONN-R36]', async () => {
    const state = await beginInstallation();
    const response = await returnFromInstallation(state, {
      params: { setup_action: 'request' },
    });
    expect(response.status).toBe(200);
    const page = readPage(await response.text());
    expect(page.heading).toBe('The installation waits for approval');
    expect(page.text).toContain(
      'Once they have approved it, select Install on GitHub again in your connector settings, and Tale picks up the installation.',
    );
    expect(page.back).toStrictEqual(BACK);
    expect(world.states.size).toBe(0);
    const later = await returnFromInstallation(state);
    expect(later.status).toBe(400);
    expect(readPage(await later.text()).heading).toBe(
      'This installation link has expired',
    );
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
  });
});

describe('an installation is stored as the app itself reads it', () => {
  it("stores what the app's own read of the installation answered [CONN-R37]", async () => {
    const state = await beginInstallation();
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `${SETTINGS}?connected=github`,
    );
    expect(service.readGithubAppInstallation).toHaveBeenCalledExactlyOnceWith(
      world.sql,
      {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        installationId: 77,
        fetchImpl: github.fetchImpl,
      },
    );
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).toHaveBeenCalledExactlyOnceWith(world.transactions[0], {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      installation: INSTALLATION,
      repositories: ['acme/api', 'acme/web'],
      repositoryCount: 2,
      actor: { userId: 'u-ada', email: 'ada@acme.example' },
    });
    expect(world.events).toStrictEqual([
      'list',
      'state',
      'claim',
      'read',
      'lock',
      'record',
    ]);
  });

  it('stores an installation on every repository without a list [CONN-R37]', async () => {
    const everywhere: GithubAppInstallationRecord = {
      id: 77,
      account: 'acme',
      accountType: 'Organization',
      repositorySelection: 'all',
    };
    service.readGithubAppInstallation.mockResolvedValue({
      ok: true,
      appId: 4242,
      installation: everywhere,
    });
    const state = await beginInstallation();
    expect((await returnFromInstallation(state)).status).toBe(302);
    expect(
      service.recordGithubAppInstallationInTransaction.mock.calls[0]?.[1],
    ).toStrictEqual({
      organizationId: 'org-1',
      credentialId: 'cred-1',
      installation: everywhere,
      actor: { userId: 'u-ada', email: 'ada@acme.example' },
    });
  });

  const REFUSALS: [ReadRefusal, number, string, string][] = [
    [
      'wrong_app',
      409,
      'That installation belongs to another app',
      'Installation 77 belongs to GitHub App 1717, not to this credential’s app 4242.',
    ],
    [
      'not_found',
      404,
      'GitHub does not know this installation',
      'GitHub knows no installation 77.',
    ],
    [
      'suspended',
      409,
      'This installation is suspended',
      'Installation 77 is suspended on GitHub.',
    ],
    [
      'rejected',
      502,
      'GitHub did not confirm this installation',
      'A JSON web token could not be decoded',
    ],
    [
      'malformed',
      502,
      'GitHub did not confirm this installation',
      'GitHub answered without the installation',
    ],
    [
      'unreachable',
      502,
      'GitHub could not be reached',
      'GitHub could not be reached (TimeoutError)',
    ],
  ];

  it.each(REFUSALS)(
    'stores nothing when the read answers %s [CONN-R37]',
    async (reason, status, heading, message) => {
      service.readGithubAppInstallation.mockImplementation(async () => {
        world.events.push('read');
        return { ok: false, reason, message };
      });
      const state = await beginInstallation();
      const response = await returnFromInstallation(state);
      expect(response.status).toBe(status);
      const page = readPage(await response.text());
      expect(page.heading).toBe(heading);
      expect(page.text).toContain(`Reason: ${message}`);
      expect(page.back).toStrictEqual(BACK);
      expect(world.events).toStrictEqual(['list', 'state', 'claim', 'read']);
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).not.toHaveBeenCalled();
      expect(warnings()).toStrictEqual([
        `[connectors:github-app] did not store installation 77 on credential cred-1 (organization org-1): ${reason}`,
      ]);
    },
  );

  it.each([
    '',
    '0',
    '-1',
    '1e3',
    '01',
    '1'.repeat(17),
    'abc',
    '9007199254740993',
    '77 ',
    '7.5',
  ])(
    'reads nothing for the installation id %j [CONN-R37]',
    async (installationId) => {
      const state = await beginInstallation();
      const response = await returnFromInstallation(state, {
        params: { installation_id: installationId },
      });
      expect(response.status).toBe(400);
      const page = readPage(await response.text());
      expect(page.heading).toBe('GitHub did not say which installation');
      expect(page.back).toStrictEqual(BACK);
      expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
    },
  );

  it('says the credential is gone when the read finds it removed [CONN-R37]', async () => {
    service.readGithubAppInstallation.mockRejectedValue(
      new ConnectorCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'Credential not found.',
        404,
      ),
    );
    const state = await beginInstallation();
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(404);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This credential cannot be installed');
    expect(page.text).toContain('Reason: Credential not found.');
    expect(page.back).toStrictEqual(BACK);
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] could not read installation 77 with credential cred-1 (organization org-1): CREDENTIAL_NOT_FOUND',
    ]);
  });

  it('says the credential is gone when it was removed before the write [CONN-R37]', async () => {
    service.recordGithubAppInstallationInTransaction.mockRejectedValue(
      new ConnectorCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'Credential not found.',
        404,
      ),
    );
    const state = await beginInstallation();
    const response = await returnFromInstallation(state);
    expect(response.status).toBe(404);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This credential cannot be installed');
    expect(page.text).toContain('Reason: Credential not found.');
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] did not store installation 77 on credential cred-1 (organization org-1): CREDENTIAL_NOT_FOUND',
    ]);
  });

  describe('a change made on GitHub, coming back without state', () => {
    const update: Visit = { params: { setup_action: 'update' } };

    it('refreshes the credentials holding it in organizations Ada administers [CONN-R37]', async () => {
      service.findGithubAppCredentialsByInstallation.mockResolvedValue([
        { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
      ]);
      const response = await returnFromInstallation(undefined, update);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `${SETTINGS}?connected=github`,
      );
      expect(
        service.findGithubAppCredentialsByInstallation,
      ).toHaveBeenCalledExactlyOnceWith(world.sql, {
        installationId: 77,
        organizationIds: ['org-1', 'org-4'],
      });
      expect(service.readGithubAppInstallation).toHaveBeenCalledExactlyOnceWith(
        world.sql,
        {
          organizationId: 'org-1',
          credentialId: 'cred-1',
          installationId: 77,
          fetchImpl: github.fetchImpl,
        },
      );
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).toHaveBeenCalledOnce();
    });

    it('writes nothing when GitHub answers what the credential holds [CONN-R37]', async () => {
      service.findGithubAppCredentialsByInstallation.mockResolvedValue([
        { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
      ]);
      service.getCredential.mockResolvedValue(INSTALLED_CREDENTIAL);
      const response = await returnFromInstallation(undefined, update);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `${SETTINGS}?connected=github`,
      );
      expect(service.getCredential).toHaveBeenCalledExactlyOnceWith(
        world.sql,
        'org-1',
        'cred-1',
      );
      // A link on any site can send an admin here: no write, so no audit
      // entry, and the credential's cached token stays.
      expect(world.events).toStrictEqual(['read']);
      expect(world.transactions).toEqual([]);
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).not.toHaveBeenCalled();
      expect(warnings()).toStrictEqual([]);
    });

    const CHANGES: [string, MaskedCredential][] = [
      ['its repository selection', holding({ repositorySelection: 'all' })],
      ['its account', holding({ account: 'acme-old' })],
      ['the kind of its account', holding({ accountType: 'User' })],
      [
        'a credential that needs reauthorization',
        { ...INSTALLED_CREDENTIAL, status: 'needs-reauth' },
      ],
    ];

    it.each(CHANGES)(
      'stores a change of %s, as Ada [CONN-R37]',
      async (_name, held) => {
        service.findGithubAppCredentialsByInstallation.mockResolvedValue([
          { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
        ]);
        service.getCredential.mockResolvedValue(held);
        const response = await returnFromInstallation(undefined, update);
        expect(response.headers.get('location')).toBe(
          `${SETTINGS}?connected=github`,
        );
        expect(world.events).toStrictEqual(['read', 'lock', 'record']);
        expect(
          service.recordGithubAppInstallationInTransaction,
        ).toHaveBeenCalledExactlyOnceWith(world.transactions[0], {
          organizationId: 'org-1',
          credentialId: 'cred-1',
          installation: INSTALLATION,
          repositories: ['acme/api', 'acme/web'],
          repositoryCount: 2,
          actor: { userId: 'u-ada', email: 'ada@acme.example' },
        });
      },
    );

    it('writes only the holders GitHub answers differently for [CONN-R37]', async () => {
      service.findGithubAppCredentialsByInstallation.mockResolvedValue([
        { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
        { id: 'cred-4', organizationId: 'org-4', connectorSlug: 'github' },
      ]);
      service.getCredential.mockImplementation(
        async (_sql, _organizationId, credentialId) =>
          credentialId === 'cred-1'
            ? INSTALLED_CREDENTIAL
            : holding({ repositorySelection: 'all' }),
      );
      const response = await returnFromInstallation(undefined, update);
      expect(response.headers.get('location')).toBe(
        `${SETTINGS}?connected=github`,
      );
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).toHaveBeenCalledOnce();
      expect(
        service.recordGithubAppInstallationInTransaction.mock.calls[0]?.[1],
      ).toMatchObject({ organizationId: 'org-4', credentialId: 'cred-4' });
    });

    it("looks only in a confined session's own organization [CONN-R37]", async () => {
      await returnFromInstallation(undefined, {
        as: confinedTo(ADA, 'org-4'),
        params: { setup_action: 'update' },
      });
      expect(
        service.findGithubAppCredentialsByInstallation,
      ).toHaveBeenCalledExactlyOnceWith(world.sql, {
        installationId: 77,
        organizationIds: ['org-4'],
      });
    });

    it('stores nothing for a member who administers no organization [CONN-R37]', async () => {
      const response = await returnFromInstallation(undefined, {
        as: LENA,
        params: { setup_action: 'update' },
      });
      expect(response.status).toBe(404);
      const page = readPage(await response.text());
      expect(page.heading).toBe(
        'Tale has no GitHub App credential for this installation',
      );
      expect(page.back).toStrictEqual(BACK);
      expect(
        service.findGithubAppCredentialsByInstallation,
      ).not.toHaveBeenCalled();
      expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
      expect(warnings()).toStrictEqual([
        '[connectors:github-app] installation 77 came back without state, and no credential the member administers holds it',
      ]);
    });

    it('answers the first refusal when no holder takes it [CONN-R37]', async () => {
      service.findGithubAppCredentialsByInstallation.mockResolvedValue([
        { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
        { id: 'cred-4', organizationId: 'org-4', connectorSlug: 'github' },
      ]);
      service.readGithubAppInstallation.mockResolvedValue({
        ok: false,
        reason: 'wrong_app',
        message: 'Installation 77 belongs to another app.',
      });
      const response = await returnFromInstallation(undefined, update);
      expect(response.status).toBe(409);
      const page = readPage(await response.text());
      expect(page.heading).toBe('That installation belongs to another app');
      expect(page.back).toStrictEqual(BACK);
      expect(service.readGithubAppInstallation).toHaveBeenCalledTimes(2);
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).not.toHaveBeenCalled();
    });

    it('answers the holder that took it [CONN-R37]', async () => {
      service.findGithubAppCredentialsByInstallation.mockResolvedValue([
        { id: 'cred-1', organizationId: 'org-1', connectorSlug: 'github' },
        { id: 'cred-4', organizationId: 'org-4', connectorSlug: 'github' },
      ]);
      service.readGithubAppInstallation
        .mockResolvedValueOnce({
          ok: false,
          reason: 'not_found',
          message: 'GitHub knows no installation 77.',
        })
        .mockResolvedValueOnce(READ);
      const response = await returnFromInstallation(undefined, update);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(
        `${ORG_4_SETTINGS}?connected=github`,
      );
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).toHaveBeenCalledOnce();
      expect(
        service.recordGithubAppInstallationInTransaction.mock.calls[0]?.[1],
      ).toMatchObject({ organizationId: 'org-4', credentialId: 'cred-4' });
    });

    it('asks a browser without a session to sign in, reading nothing', async () => {
      const response = await returnFromInstallation(undefined, {
        as: null,
        params: { setup_action: 'update' },
      });
      expect(response.status).toBe(401);
      const page = readPage(await response.text());
      expect(page.heading).toBe('Sign in to Tale to finish');
      expect(page.back).toStrictEqual(TALE);
      expect(world.statements).toEqual([]);
    });

    it('reads nothing without an installation id', async () => {
      const response = await returnFromInstallation(undefined, {
        params: { setup_action: 'update', installation_id: undefined },
      });
      expect(response.status).toBe(400);
      expect(readPage(await response.text()).heading).toBe(
        'GitHub did not say which installation',
      );
      expect(
        service.findGithubAppCredentialsByInstallation,
      ).not.toHaveBeenCalled();
    });
  });
});

describe('the install door', () => {
  it.each([
    ['no organization', { organizationId: undefined }, TALE],
    ['no credential', { credentialId: undefined }, BACK],
    ['an overlong credential id', { credentialId: 'c'.repeat(129) }, BACK],
  ])('sends nothing to GitHub for %s', async (_name, params: Params, back) => {
    const response = await openInstall(params);
    expect(response.status).toBe(404);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This credential cannot be installed');
    expect(page.back).toStrictEqual(back);
    expect(service.getCredential).not.toHaveBeenCalled();
    expect(world.states.size).toBe(0);
  });

  it('installs no credential that is not a GitHub App', async () => {
    service.getCredential.mockResolvedValue(BEARER_CREDENTIAL);
    const response = await openInstall();
    expect(response.status).toBe(404);
    expect(readPage(await response.text()).heading).toBe(
      'This credential cannot be installed',
    );
    expect(world.states.size).toBe(0);
  });

  it("installs no other organization's or removed credential", async () => {
    service.getCredential.mockRejectedValue(
      new ConnectorCredentialError(
        'CREDENTIAL_NOT_FOUND',
        'Credential not found.',
        404,
      ),
    );
    const response = await openInstall();
    expect(response.status).toBe(404);
    expect(world.states.size).toBe(0);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] refused an installation of credential cred-1 (organization org-1): CREDENTIAL_NOT_FOUND',
    ]);
  });
});

describe('an installation GitHub already has', () => {
  /** The app's own list of its installations answers `installations`. */
  function listing(...installations: GithubAppInstallationInfo[]): void {
    service.listGithubAppInstallations.mockImplementation(async () => {
      world.events.push('list');
      return { ok: true, value: installations };
    });
  }

  function expectSentToGithub(response: Response): void {
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    const state = stateIn(location);
    expect(location).toBe(
      `https://github.com/apps/acme-tale/installations/new?state=${state}`,
    );
  }

  it('sends Ada to GitHub while the app has none, after its own JWT lists them [CONN-R37]', async () => {
    const response = await openInstall();
    expectSentToGithub(response);
    expect(service.listGithubAppInstallations).toHaveBeenCalledExactlyOnceWith(
      world.sql,
      {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        fetchImpl: github.fetchImpl,
      },
    );
    expect(world.events).toStrictEqual(['list', 'state']);
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
  });

  it('adopts it at the install door, read and stored as a return is, with no state [CONN-R37]', async () => {
    listing(LISTED);
    const response = await openInstall();
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `${SETTINGS}?connected=github`,
    );
    expect(headerValues(response, ['cache-control', 'vary'])).toStrictEqual({
      'cache-control': 'no-store',
      vary: 'Cookie',
    });
    expect(service.readGithubAppInstallation).toHaveBeenCalledExactlyOnceWith(
      world.sql,
      {
        organizationId: 'org-1',
        credentialId: 'cred-1',
        installationId: 77,
        fetchImpl: github.fetchImpl,
      },
    );
    // The service audits the write, as Ada, under her membership's lock.
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).toHaveBeenCalledExactlyOnceWith(world.transactions[0], {
      organizationId: 'org-1',
      credentialId: 'cred-1',
      installation: INSTALLATION,
      repositories: ['acme/api', 'acme/web'],
      repositoryCount: 2,
      actor: { userId: 'u-ada', email: 'ada@acme.example' },
    });
    expect(world.events).toStrictEqual(['list', 'read', 'lock', 'record']);
    expect(world.states.size).toBe(0);
    expect(github.calls).toEqual([]);
  });

  it('picks up an installation an owner approved once Ada selects Install on GitHub again [CONN-R37]', async () => {
    const state = await beginInstallation();
    const waiting = await returnFromInstallation(state, {
      params: { setup_action: 'request' },
    });
    expect(readPage(await waiting.text()).heading).toBe(
      'The installation waits for approval',
    );
    // The owner approves on GitHub, which then offers only to configure it.
    listing(LISTED);
    const again = await openInstall();
    expect(again.headers.get('location')).toBe(`${SETTINGS}?connected=github`);
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).toHaveBeenCalledOnce();
    expect(world.states.size).toBe(0);
  });

  const ADOPTED: [string, MaskedCredential, GithubAppInstallationInfo][] = [
    [
      'a credential that needs reauthorization',
      { ...INSTALLED_CREDENTIAL, status: 'needs-reauth' },
      LISTED,
    ],
    [
      'an installation in place of the one it held',
      INSTALLED_CREDENTIAL,
      { ...LISTED, id: 78 },
    ],
  ];

  it.each(ADOPTED)(
    'adopts it for %s [CONN-R37]',
    async (_name, credential, listed) => {
      service.getCredential.mockResolvedValue(credential);
      listing(listed);
      const response = await openInstall();
      expect(response.headers.get('location')).toBe(
        `${SETTINGS}?connected=github`,
      );
      expect(
        service.readGithubAppInstallation.mock.calls[0]?.[1],
      ).toMatchObject({ installationId: listed.id });
      expect(
        service.recordGithubAppInstallationInTransaction,
      ).toHaveBeenCalledOnce();
    },
  );

  it('sends Ada to GitHub to change the repositories of the installation her credential holds [CONN-R37]', async () => {
    service.getCredential.mockResolvedValue(INSTALLED_CREDENTIAL);
    listing(LISTED);
    expectSentToGithub(await openInstall());
    expect(world.events).toStrictEqual(['list', 'state']);
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).not.toHaveBeenCalled();
  });

  it("lets GitHub's page choose among several installations [CONN-R37]", async () => {
    listing(LISTED, { ...LISTED, id: 78, account: 'acme-labs' });
    expectSentToGithub(await openInstall());
    expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      "[connectors:github-app] the app of credential cred-1 (organization org-1) has 2 installations; GitHub's page chooses",
    ]);
  });

  it('refuses a suspended one, storing nothing [CONN-R37]', async () => {
    listing({ ...LISTED, suspended: true });
    service.readGithubAppInstallation.mockResolvedValue({
      ok: false,
      reason: 'suspended',
      message: 'Installation 77 is suspended on GitHub.',
    });
    const response = await openInstall();
    expect(response.status).toBe(409);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This installation is suspended');
    expect(page.back).toStrictEqual(BACK);
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).not.toHaveBeenCalled();
    expect(world.states.size).toBe(0);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] did not store installation 77 on credential cred-1 (organization org-1): suspended',
    ]);
  });

  it('repeats the admin check under the membership lock before adopting it [CONN-R35]', async () => {
    listing(LISTED);
    service.readGithubAppInstallation.mockImplementation(async () => {
      world.events.push('read');
      world.setRole('u-ada', 'org-1', 'member');
      return READ;
    });
    const response = await openInstall();
    expect(response.status).toBe(403);
    const page = readPage(await response.text());
    expect(page.heading).toBe('Only an admin can finish this');
    expect(page.links).toStrictEqual([TALE]);
    expect(world.events).toStrictEqual(['list', 'read', 'lock']);
    expect(
      service.recordGithubAppInstallationInTransaction,
    ).not.toHaveBeenCalled();
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] did not store installation 77: the member is no longer an admin of organization org-1',
    ]);
  });

  const LIST_REFUSALS: [string, GithubAppFailure, string, string][] = [
    [
      "the app's JWT refused",
      {
        ok: false,
        reason: 'rejected',
        status: 401,
        message: 'GitHub refused the request (401)',
      },
      'GitHub did not confirm this installation',
      'rejected (401)',
    ],
    [
      'an answer without the list',
      {
        ok: false,
        reason: 'malformed',
        message: 'GitHub answered without the installation list',
      },
      'GitHub did not confirm this installation',
      'malformed',
    ],
    [
      'no answer',
      {
        ok: false,
        reason: 'unreachable',
        message: 'GitHub could not be reached (TypeError)',
      },
      'GitHub could not be reached',
      'unreachable',
    ],
  ];

  it.each(LIST_REFUSALS)(
    'sends Ada nowhere on %s, and says so [CONN-R37]',
    async (_name, refusal, heading, logged) => {
      service.listGithubAppInstallations.mockResolvedValue(refusal);
      const response = await openInstall();
      expect(response.status).toBe(502);
      const page = readPage(await response.text());
      expect(page.heading).toBe(heading);
      expect(page.text).toContain(`Reason: ${refusal.message}`);
      expect(page.back).toStrictEqual(BACK);
      expect(world.states.size).toBe(0);
      expect(service.readGithubAppInstallation).not.toHaveBeenCalled();
      expect(warnings()).toStrictEqual([
        `[connectors:github-app] did not install credential cred-1 (organization org-1): its app could not list its installations: ${logged}`,
      ]);
    },
  );

  it('says the credential cannot be installed when its key no longer signs [CONN-R37]', async () => {
    const message =
      'Credential "Acme GitHub" holds a GitHub App private key that does not load — remove it and register the app again in Settings → Connectors.';
    service.listGithubAppInstallations.mockRejectedValue(
      new ConnectorCredentialError('CREDENTIAL_SHAPE_INVALID', message),
    );
    const response = await openInstall();
    expect(response.status).toBe(404);
    const page = readPage(await response.text());
    expect(page.heading).toBe('This credential cannot be installed');
    expect(page.text).toContain(`Reason: ${message}`);
    expect(world.states.size).toBe(0);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] could not list the installations of credential cred-1 (organization org-1): CREDENTIAL_SHAPE_INVALID',
    ]);
  });
});

describe('a registration GitHub does not complete', () => {
  const CONVERSION_FAILURES: [string, () => Answer, number, string, string][] =
    [
      [
        'a refusal',
        () => answer(422, { message: 'Validation Failed' }),
        400,
        'Validation Failed',
        'rejected (422)',
      ],
      [
        'an unknown code',
        () => answer(404, { message: 'Not Found' }),
        400,
        'Not Found',
        'not_found (404)',
      ],
      [
        'an outage',
        () => answer(503, { message: 'Service Unavailable' }),
        502,
        'Service Unavailable',
        'unreachable (503)',
      ],
      [
        'an answer without the app',
        () => answer(201, { id: 4242 }),
        502,
        'GitHub answered without the registered app',
        'malformed',
      ],
      [
        'no answer',
        () => Promise.reject(new TypeError('fetch failed')),
        502,
        'GitHub could not be reached (TypeError)',
        'unreachable',
      ],
    ];

  it.each(CONVERSION_FAILURES)(
    'quotes GitHub on %s, and says where to delete the app',
    async (_name, conversion, status, message, logged) => {
      github.handlers.conversion = conversion;
      const state = await beginRegistration();
      const response = await returnFromRegistration(state);
      expect(response.status).toBe(status);
      const page = readPage(await response.text());
      expect(page.heading).toBe('GitHub did not hand over the new app');
      expect(page.text).toContain(`GitHub said: ${message}`);
      expect(page.text).toContain(ORPHAN_UNKNOWN);
      expect(page.back).toStrictEqual(BACK);
      expect(
        service.createGithubAppCredentialInTransaction,
      ).not.toHaveBeenCalled();
      expect(world.states.size).toBe(0);
      expect(warnings()).toStrictEqual([
        `[connectors:github-app] GitHub did not trade a registration's code for organization org-1: ${logged}`,
      ]);
    },
  );

  it("shows GitHub's message as text", async () => {
    github.handlers.conversion = () =>
      answer(422, { message: 'Bad <b>manifest</b> & more' });
    const state = await beginRegistration();
    const html = await (await returnFromRegistration(state)).text();
    expect(html).not.toContain('<b>');
    expect(readPage(html).text).toContain(
      'GitHub said: Bad <b>manifest</b> & more',
    );
  });

  it.each([
    ['no code', undefined],
    ['an empty code', ''],
    ['an overlong code', 'c'.repeat(257)],
  ])('sends GitHub nothing for %s', async (_name, code) => {
    const state = await beginRegistration();
    const response = await returnFromRegistration(state, { params: { code } });
    expect(response.status).toBe(400);
    const page = readPage(await response.text());
    expect(page.heading).toBe('GitHub did not hand over the new app');
    expect(page.text).toContain(ORPHAN_UNKNOWN);
    expect(github.calls).toEqual([]);
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] a registration return for organization org-1 carried no usable code',
    ]);
  });

  it("stores the app without its bot's id when GitHub does not show the bot", async () => {
    github.handlers.bot = () => answer(404, { message: 'Not Found' });
    const state = await beginRegistration();
    expect((await returnFromRegistration(state)).status).toBe(302);
    expect(
      service.createGithubAppCredentialInTransaction.mock.calls[0]?.[1].app,
    ).toStrictEqual({
      appId: 4242,
      clientId: 'Iv23liAcmeTale',
      slug: 'acme-tale',
      privateKey: PRIVATE_KEY,
      owner: 'acme',
    });
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] could not read the bot user of the app "acme-tale": not_found (404)',
    ]);
  });

  it('says where to delete an app Tale could not store', async () => {
    service.createGithubAppCredentialInTransaction.mockRejectedValue(
      new ConnectorCredentialError(
        'CREDENTIAL_NAME_TAKEN',
        'A credential named "Acme GitHub" already exists for this connector — pick a different name.',
        409,
      ),
    );
    const state = await beginRegistration();
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(500);
    const page = readPage(await response.text());
    expect(page.heading).toBe('The app could not be saved in Tale');
    expect(page.text).toContain(
      'Reason: A credential named "Acme GitHub" already exists for this connector — pick a different name.',
    );
    expect(page.text).toContain(ORPHAN_KNOWN);
    expect(page.links).toStrictEqual([
      { href: ORG_APP_SETTINGS, text: ORPHAN_LINK },
      BACK,
    ]);
    expect(world.states.size).toBe(0);
    expect(errors()).toStrictEqual([
      '[connectors:github-app] could not store the app "acme-tale" registered for organization org-1: CREDENTIAL_NAME_TAKEN',
    ]);
  });

  it('names only the kind of a failed write, never its message or the key it held', async () => {
    service.createGithubAppCredentialInTransaction.mockRejectedValue(
      new Error(`could not seal ${PRIVATE_KEY}`),
    );
    const state = await beginRegistration();
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).not.toContain(KEY_MATERIAL);
    expect(readPage(html).text).not.toContain('Reason:');
    expect(errors()).toStrictEqual([
      '[connectors:github-app] could not store the app "acme-tale" registered for organization org-1: Error',
    ]);
  });

  it("links a personal account's app settings for an app registered there", async () => {
    github.handlers.conversion = () =>
      answer(201, {
        ...REGISTERED_APP,
        owner: { login: 'ada-lovelace', id: 2, type: 'User' },
      });
    service.createGithubAppCredentialInTransaction.mockRejectedValue(
      new Error('connection reset'),
    );
    const state = await beginRegistration({ owner: undefined });
    const response = await returnFromRegistration(state);
    expect(readPage(await response.text()).links).toStrictEqual([
      { href: 'https://github.com/settings/apps/acme-tale', text: ORPHAN_LINK },
      BACK,
    ]);
  });
});

describe("the registration's code", () => {
  it('is never logged, whatever fails after it arrives', async () => {
    github.handlers.conversion = (code) =>
      answer(422, { message: `The code ${code} is not valid` });
    const refused = await returnFromRegistration(await beginRegistration());
    expect(refused.status).toBe(400);
    github.handlers.conversion = () => answer(201, REGISTERED_APP);
    service.createGithubAppCredentialInTransaction.mockRejectedValue(
      new Error(`could not store ${CODE} with ${PRIVATE_KEY}`),
    );
    const unstored = await returnFromRegistration(await beginRegistration());
    expect(unstored.status).toBe(500);
    expect(warnings().length + errors().length).toBeGreaterThan(0);
    const logged = logs.map((log) => log.text).join('\n');
    for (const secret of [CODE, KEY_MATERIAL, CLIENT_SECRET]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("is never shown back, raw or encoded, inside GitHub's own message", async () => {
    const code = 'c0de+5f/7a2e9d4b6a8c01';
    const encoded = encodeURIComponent(code);
    secrets.push(code, encoded);
    github.handlers.conversion = () =>
      answer(422, { message: `The code ${code} (${encoded}) is not valid` });
    const state = await beginRegistration();
    const response = await returnFromRegistration(state, { params: { code } });
    const html = await response.text();
    expect(github.calls).toStrictEqual([
      {
        method: 'POST',
        url: `https://api.github.com/app-manifests/${encoded}/conversions`,
      },
    ]);
    expect(readPage(html).text).toContain(
      'GitHub said: The code … (…) is not valid',
    );
    expect(html).not.toContain(code);
    expect(html).not.toContain(encoded);
  });

  it('stays out of the log when GitHub answers without JSON', async () => {
    github.handlers.conversion = () =>
      answer(502, '<html><body>Bad gateway</body></html>');
    const state = await beginRegistration();
    const response = await returnFromRegistration(state);
    expect(response.status).toBe(502);
    expect(readPage(await response.text()).text).toContain(
      'GitHub said: GitHub answered 502',
    );
    expect(warnings()).toStrictEqual([
      '[connectors:github-app] GitHub answered 502 without JSON: SyntaxError',
      "[connectors:github-app] GitHub did not trade a registration's code for organization org-1: unreachable (502)",
    ]);
  });
});

describe('the pages a return answers', () => {
  it.each([
    [
      'de',
      'Dieser Registrierungslink ist abgelaufen',
      'Zurück zu den Connector-Einstellungen',
      'de',
    ],
    [
      'fr',
      'Ce lien d’enregistrement a expiré',
      'Retour aux paramètres des connecteurs',
      'fr',
    ],
    [
      'de-CH,de;q=0.9,en;q=0.5',
      'Dieser Registrierungslink ist abgelaufen',
      'Zurück zu den Connector-Einstellungen',
      'de',
    ],
  ])(
    'speak the language a browser asks for (%s)',
    async (language, heading, back, locale) => {
      const response = await returnFromRegistration('forged-state', {
        language,
      });
      expect(response.headers.get('content-language')).toBe(locale);
      const page = readPage(await response.text());
      expect(page.heading).toBe(heading);
      expect(page.back).toStrictEqual({ href: SETTINGS, text: back });
    },
  );
});

describe('the routes in the whole app', () => {
  it("keep the hand-off's own policy under the app's security headers, its meta tag the referrer policy [CONN-R34]", async () => {
    const network = vi.fn(() =>
      Promise.reject(new Error('The whole app reaches no GitHub here')),
    );
    // The routes take the global fetch when the app is built.
    vi.stubGlobal('fetch', network);
    const whole = createApp({ sql: world.sql as unknown as Sql, auth });
    const handoff = await whole.request(
      `/api/connectors/github-app/register${query(REGISTRATION)}`,
      { headers: headersOf({}, 'same-origin') },
    );
    expect(handoff.status).toBe(200);
    // The app's headers set the referrer policy of every answer; the page's
    // meta tag is what keeps its form and links from naming Tale's URL.
    expect(
      headerValues(handoff, [
        'content-security-policy',
        'referrer-policy',
        'strict-transport-security',
        'x-content-type-options',
        'x-frame-options',
      ]),
    ).toStrictEqual({
      'content-security-policy': GITHUB_APP_HANDOFF_CSP,
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    const html = await handoff.text();
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    stateIn(handoffOf(html).action);

    // A redirect to GitHub hands on no more than Tale's origin.
    const install = await whole.request(
      `/api/connectors/github-app/install${query({ organizationId: 'org-1', credentialId: 'cred-1' })}`,
      { headers: headersOf({}, 'same-origin') },
    );
    expect(install.status).toBe(302);
    stateIn(install.headers.get('location') ?? '');
    expect(install.headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    );

    const forged = await whole.request(
      `/api/connectors/github-app/registered?state=forged-state&code=${CODE}`,
    );
    expect(forged.status).toBe(400);
    expect(forged.headers.get('content-security-policy')).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(network).not.toHaveBeenCalled();
  });
});
