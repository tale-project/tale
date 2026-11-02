'use node';

/**
 * GitHub's side of a `github-app` credential: the manifest an organization
 * registers its own app from, the JWT the app signs with its private key,
 * and the few calls that turn a registration and an installation into
 * short-lived installation tokens.
 *
 * Every call takes its `fetch` as an argument, so the wire format is
 * testable without GitHub. Nothing here logs or returns a secret it did not
 * have to: the conversion answer's client secret and webhook secret are
 * dropped on arrival (Tale signs with the private key alone, and its app has
 * no webhook), and a refusal carries GitHub's message and status only.
 */

import { createPrivateKey } from 'node:crypto';

import { SignJWT } from 'jose';
import { z } from 'zod/v4';

import type { FetchLike } from '../http_connectors/token_exchange.ts';
import { GITHUB_APP_SLUG_RE } from './auth_injection.ts';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_WEB_ORIGIN = 'https://github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_TIMEOUT_MS = 15_000;

/** GitHub refuses an app name longer than this. */
export const GITHUB_APP_NAME_MAX = 34;

/** A GitHub account login: letters, digits and single inner hyphens. */
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;

/** How long a JWT reaches back, so a GitHub clock a little behind accepts
 * it; GitHub's own recommendation. */
const JWT_BACKDATE_S = 60;
/** How long a JWT lives from now. GitHub refuses one that expires more than
 * ten minutes out; this stays inside that with room for clock drift. */
const JWT_LIFETIME_S = 540;

export type GithubPermissionLevel = 'read' | 'write';
export type GithubPermissions = Readonly<Record<string, GithubPermissionLevel>>;

/** What a GitHub call answers when it does not succeed. `message` is
 * GitHub's own error text (never a token: GitHub echoes none), for the
 * server log and a person's refusal. */
export interface GithubAppFailure {
  readonly ok: false;
  /**
   * - `unreachable` — transport failure, timeout, or GitHub down or
   *   throttling (5xx, 429): worth a later retry, never a person's fix;
   * - `not_found` — the code, app or installation no longer exists;
   * - `rejected` — GitHub refused the request (a bad JWT, a permission or
   *   repository the installation does not grant, a suspended install);
   * - `malformed` — a success that does not carry what it should.
   */
  readonly reason: 'unreachable' | 'not_found' | 'rejected' | 'malformed';
  readonly status?: number;
  readonly message: string;
}

export type GithubAppResult<T> =
  | { readonly ok: true; readonly value: T }
  | GithubAppFailure;

export interface GithubAppManifestInput {
  /** The app's name on GitHub, at most {@link GITHUB_APP_NAME_MAX}. */
  readonly name: string;
  /** Tale's public base URL: the app's homepage. */
  readonly baseUrl: string;
  /** Where GitHub sends the browser back with the registration's code. */
  readonly redirectUrl: string;
  /** Where GitHub sends the browser after an install or a change of it. */
  readonly setupUrl: string;
  /** Exactly what the connector's `github-app` entry asks for. */
  readonly permissions: GithubPermissions;
}

/**
 * The manifest GitHub registers the organization's app from. Private, no
 * events, no webhook and no OAuth on install: the app exists to sign Tale's
 * own calls, and asks for exactly the permissions the connector names.
 * GitHub wants a webhook URL even for a webhook that is off, and refuses a
 * loopback one, so a Tale on localhost registers without the hook entry.
 */
export function buildGithubAppManifest(input: GithubAppManifestInput) {
  return {
    name: input.name,
    url: input.baseUrl,
    description:
      'Signs the commits, pull requests, reviews and comments Tale makes in your repositories.',
    public: false,
    redirect_url: input.redirectUrl,
    setup_url: input.setupUrl,
    setup_on_update: true,
    request_oauth_on_install: false,
    ...(!isLoopback(input.baseUrl) && {
      hook_attributes: { url: input.baseUrl, active: false },
    }),
    default_permissions: { ...input.permissions },
  };
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname;
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/** Where the admin's browser posts the manifest: their own account, or the
 * GitHub organization they name. */
export function githubAppRegistrationUrl(
  state: string,
  organization?: string,
): string {
  const path =
    organization === undefined
      ? '/settings/apps/new'
      : `/organizations/${encodeURIComponent(organization)}/settings/apps/new`;
  return `${GITHUB_WEB_ORIGIN}${path}?state=${encodeURIComponent(state)}`;
}

/** Where a person installs the app, choosing the account and repositories. */
export function githubAppInstallUrl(slug: string, state: string): string {
  return `${GITHUB_WEB_ORIGIN}/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * The JWT the app signs to speak for itself: RS256, issued a minute back,
 * expiring within GitHub's ten minutes, issued by the app's client ID.
 */
export async function signGithubAppJwt(args: {
  readonly clientId: string;
  readonly privateKey: string;
  readonly nowMs: number;
}): Promise<string> {
  const now = Math.floor(args.nowMs / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(args.clientId)
    .setIssuedAt(now - JWT_BACKDATE_S)
    .setExpirationTime(now + JWT_LIFETIME_S)
    .sign(createPrivateKey(args.privateKey));
}

/** The app GitHub registered from the manifest. Its client secret and
 * webhook secret are not here: Tale never keeps them. */
export interface RegisteredGithubApp {
  readonly appId: number;
  readonly slug: string;
  readonly name: string;
  readonly clientId: string;
  readonly privateKey: string;
  readonly owner?: string;
  readonly htmlUrl: string;
  readonly permissions: Readonly<Record<string, string>>;
}

const registeredAppSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().regex(GITHUB_APP_SLUG_RE),
  name: z.string().min(1),
  client_id: z.string().min(1).max(256),
  pem: z.string().min(1),
  owner: z
    .object({ login: z.string().min(1) })
    .nullable()
    .optional(),
  html_url: z.string().url(),
  permissions: z.record(z.string(), z.string()).default({}),
});

/** Trade the registration's one-hour code for the app and its key. */
export async function convertManifestCode(
  code: string,
  fetchImpl: FetchLike,
): Promise<GithubAppResult<RegisteredGithubApp>> {
  const answer = await callGithub(
    fetchImpl,
    'POST',
    `/app-manifests/${encodeURIComponent(code)}/conversions`,
  );
  if (!answer.ok) return answer;
  const parsed = registeredAppSchema.safeParse(answer.value);
  if (!parsed.success) return malformed('the registered app');
  const app = parsed.data;
  return {
    ok: true,
    value: {
      appId: app.id,
      slug: app.slug,
      name: app.name,
      clientId: app.client_id,
      privateKey: app.pem,
      ...(app.owner?.login !== undefined && { owner: app.owner.login }),
      htmlUrl: app.html_url,
      permissions: app.permissions,
    },
  };
}

/** An installation as GitHub reports it to the app that owns it. */
export interface GithubAppInstallationInfo {
  readonly id: number;
  readonly appId: number;
  readonly account: string;
  readonly accountType: 'User' | 'Organization';
  readonly repositorySelection: 'all' | 'selected';
  readonly permissions: Readonly<Record<string, string>>;
  readonly suspended: boolean;
}

const installationSchema = z.object({
  id: z.number().int().positive(),
  app_id: z.number().int().positive(),
  account: z.object({
    login: z.string().min(1),
    type: z.enum(['User', 'Organization']),
  }),
  repository_selection: z.enum(['all', 'selected']),
  permissions: z.record(z.string(), z.string()).default({}),
  suspended_at: z.string().nullable().optional(),
});

/** Read an installation with the app's JWT — the only proof that an
 * installation id a browser brought back belongs to this app. */
export async function getInstallation(
  jwt: string,
  installationId: number,
  fetchImpl: FetchLike,
): Promise<GithubAppResult<GithubAppInstallationInfo>> {
  const answer = await callGithub(
    fetchImpl,
    'GET',
    `/app/installations/${installationId}`,
    { authorization: `Bearer ${jwt}` },
  );
  if (!answer.ok) return answer;
  const parsed = installationSchema.safeParse(answer.value);
  if (!parsed.success) return malformed('the installation');
  return { ok: true, value: installationInfo(parsed.data) };
}

/** The app's installations, the first hundred of them, read with its JWT.
 * The manifest registers every app private (`public: false`), and GitHub
 * installs a private app only on the account that owns it — so this lists
 * one installation at most, unless the app's owner made it public. */
export async function listAppInstallations(
  jwt: string,
  fetchImpl: FetchLike,
): Promise<GithubAppResult<GithubAppInstallationInfo[]>> {
  const answer = await callGithub(
    fetchImpl,
    'GET',
    '/app/installations?per_page=100',
    { authorization: `Bearer ${jwt}` },
  );
  if (!answer.ok) return answer;
  const parsed = z.array(installationSchema).safeParse(answer.value);
  if (!parsed.success) return malformed('the installation list');
  return { ok: true, value: parsed.data.map(installationInfo) };
}

function installationInfo(
  installation: z.infer<typeof installationSchema>,
): GithubAppInstallationInfo {
  return {
    id: installation.id,
    appId: installation.app_id,
    account: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    permissions: installation.permissions,
    suspended: typeof installation.suspended_at === 'string',
  };
}

/** An installation token and what GitHub granted it. */
export interface MintedInstallationToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly permissions: Readonly<Record<string, string>>;
  readonly repositorySelection: 'all' | 'selected';
  /** The repositories the token is narrowed to, when it is. */
  readonly repositories?: readonly string[];
}

const mintedTokenSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1),
  permissions: z.record(z.string(), z.string()).default({}),
  repository_selection: z.enum(['all', 'selected']),
  repositories: z.array(z.object({ full_name: z.string() })).optional(),
});

/**
 * Mint an installation token narrowed to `permissions` and, when given, to
 * `repositories` (names without their owner). GitHub refuses (422) a
 * permission or repository the installation does not grant, so callers ask
 * for what {@link narrowPermissions} leaves.
 */
export async function mintInstallationToken(
  args: {
    readonly jwt: string;
    readonly installationId: number;
    readonly permissions: GithubPermissions;
    readonly repositories?: readonly string[];
  },
  fetchImpl: FetchLike,
): Promise<GithubAppResult<MintedInstallationToken>> {
  const answer = await callGithub(
    fetchImpl,
    'POST',
    `/app/installations/${args.installationId}/access_tokens`,
    { authorization: `Bearer ${args.jwt}` },
    {
      permissions: args.permissions,
      ...(args.repositories !== undefined && {
        repositories: args.repositories,
      }),
    },
  );
  if (!answer.ok) return answer;
  const parsed = mintedTokenSchema.safeParse(answer.value);
  const expiresAt = parsed.success
    ? Date.parse(parsed.data.expires_at)
    : Number.NaN;
  if (!parsed.success || !Number.isFinite(expiresAt)) {
    return malformed('the installation token');
  }
  return {
    ok: true,
    value: {
      token: parsed.data.token,
      expiresAt,
      permissions: parsed.data.permissions,
      repositorySelection: parsed.data.repository_selection,
      ...(parsed.data.repositories !== undefined && {
        repositories: parsed.data.repositories.map((repo) => repo.full_name),
      }),
    },
  };
}

/** The first page of the repositories an installation covers. */
export interface InstallationRepositories {
  readonly totalCount: number;
  readonly repositories: readonly {
    readonly fullName: string;
    readonly private: boolean;
    readonly htmlUrl: string;
  }[];
}

const installationRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(
    z.object({
      full_name: z.string().min(1),
      private: z.boolean(),
      html_url: z.string().url(),
    }),
  ),
});

/** The repositories an installation token reaches, up to `perPage` of them
 * (GitHub's limit is 100) with the total. */
export async function listInstallationRepositories(
  token: string,
  fetchImpl: FetchLike,
  perPage = 100,
): Promise<GithubAppResult<InstallationRepositories>> {
  const answer = await callGithub(
    fetchImpl,
    'GET',
    `/installation/repositories?per_page=${perPage}`,
    { authorization: `Bearer ${token}` },
  );
  if (!answer.ok) return answer;
  const parsed = installationRepositoriesSchema.safeParse(answer.value);
  if (!parsed.success) return malformed('the repository list');
  return {
    ok: true,
    value: {
      totalCount: parsed.data.total_count,
      repositories: parsed.data.repositories.map((repo) => ({
        fullName: repo.full_name,
        private: repo.private,
        htmlUrl: repo.html_url,
      })),
    },
  };
}

/** The id of the app's bot user, `<slug>[bot]`: the public profile every
 * GitHub App has, which its commits and comments link to. */
export async function getBotUserId(
  slug: string,
  fetchImpl: FetchLike,
): Promise<GithubAppResult<number>> {
  const answer = await callGithub(
    fetchImpl,
    'GET',
    `/users/${encodeURIComponent(`${slug}[bot]`)}`,
  );
  if (!answer.ok) return answer;
  const parsed = z
    .object({ id: z.number().int().positive() })
    .safeParse(answer.value);
  return parsed.success
    ? { ok: true, value: parsed.data.id }
    : malformed('the bot user');
}

/**
 * The permissions to ask a token for: each one the connector names, at the
 * lower of the level it names and the level the installation grants, and
 * none the installation does not grant. An installation that has not
 * accepted a permission the connector added since narrows the token instead
 * of failing every call; one that grants more than the connector names
 * never widens it.
 */
export function narrowPermissions(
  wanted: GithubPermissions,
  granted: Readonly<Record<string, string>>,
): Record<string, GithubPermissionLevel> {
  const narrowed: Record<string, GithubPermissionLevel> = {};
  for (const [name, level] of Object.entries(wanted)) {
    const grant = granted[name];
    if (grant === 'read') narrowed[name] = 'read';
    else if (grant === 'write' || grant === 'admin') narrowed[name] = level;
  }
  return narrowed;
}

function malformed(what: string): GithubAppFailure {
  return {
    ok: false,
    reason: 'malformed',
    message: `GitHub answered without ${what}`,
  };
}

/** One call to GitHub's API: JSON in and out, GitHub's versioned headers,
 * and every failure mapped onto {@link GithubAppFailure}. */
async function callGithub(
  fetchImpl: FetchLike,
  method: 'GET' | 'POST',
  path: string,
  auth: { readonly authorization?: string } = {},
  body?: unknown,
): Promise<GithubAppResult<unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'Tale',
        ...(auth.authorization !== undefined && {
          Authorization: auth.authorization,
        }),
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      message: `GitHub could not be reached (${error instanceof Error ? error.name : 'unknown error'})`,
    };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    // The path is not logged: a registration's code is in it, and that
    // code buys the app's private key until GitHub has traded it.
    console.warn(
      `[connectors:github-app] GitHub answered ${response.status} without JSON:`,
      error instanceof Error ? error.name : 'unknown error',
    );
    payload = undefined;
  }
  if (response.ok && payload !== undefined) return { ok: true, value: payload };
  const message =
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
      ? payload.message.slice(0, 300)
      : `GitHub answered ${response.status}`;
  return {
    ok: false,
    reason:
      response.status >= 500 || response.status === 429
        ? 'unreachable'
        : response.status === 404
          ? 'not_found'
          : response.ok
            ? 'malformed'
            : 'rejected',
    status: response.status,
    message,
  };
}
