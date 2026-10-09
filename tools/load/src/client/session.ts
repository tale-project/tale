/**
 * One virtual user's identity on the deployment: credentials, the session
 * cookie, the organization they act in, and the HTTP client every one of
 * their requests goes through (so each request carries their cookie).
 *
 * A user gets a session one of two ways: `signIn` (or `signUp`) through
 * Better Auth like a browser would, or `adoptSessionToken`, which puts a
 * cookie for a session the seed wrote straight into the database into the
 * jar — a million users cannot all sign in through a 30-per-minute-per-IP
 * door before the run starts.
 */

import type { Dispatcher } from 'undici/index.js';

import type { MetricsRegistry } from '../metrics/registry.ts';
import { CookieJar, sessionCookieName, signSessionToken } from './cookies.ts';
import { HttpClient } from './http.ts';
import type { HttpRequestOptions, HttpResponse } from './http.ts';

export interface UserSessionOptions {
  baseUrl: string;
  agent: Dispatcher;
  metrics: MetricsRegistry;
  email: string;
  password: string;
  userId?: string;
  orgId?: string;
  orgSlug?: string;
  /** See `HttpClientOptions.forwardedFor`. */
  forwardedFor?: string;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface AuthResult {
  ok: boolean;
  status: number;
  userId?: string;
}

export interface SignInResult extends AuthResult {
  /** Better Auth answered with a second-factor challenge, not a session. */
  twoFactorRedirect?: boolean;
}

export interface SessionInfo {
  ok: boolean;
  status: number;
  userId?: string;
  activeOrganizationId?: string;
}

export interface CreatedOrganization {
  ok: boolean;
  status: number;
  id?: string;
  slug?: string;
}

interface AuthBody {
  user?: { id?: unknown };
  twoFactorRedirect?: unknown;
}

interface SessionBody {
  user?: { id?: unknown };
  session?: { activeOrganizationId?: unknown };
}

interface OrganizationBody {
  id?: unknown;
  slug?: unknown;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export class UserSession {
  readonly email: string;
  readonly password: string;
  userId: string | undefined;
  orgId: string | undefined;
  orgSlug: string | undefined;
  readonly cookies: CookieJar;
  readonly http: HttpClient;
  /** The session cookie's name on this deployment. */
  readonly cookieName: string;

  constructor(options: UserSessionOptions) {
    this.email = options.email;
    this.password = options.password;
    this.userId = options.userId;
    this.orgId = options.orgId;
    this.orgSlug = options.orgSlug;
    this.cookies = new CookieJar();
    this.cookieName = sessionCookieName(options.baseUrl);
    this.http = new HttpClient({
      baseUrl: options.baseUrl,
      agent: options.agent,
      metrics: options.metrics,
      defaultHeaders: options.defaultHeaders,
      timeoutMs: options.timeoutMs,
      forwardedFor: options.forwardedFor,
      cookies: this.cookies,
    });
  }

  /** Whether the jar holds a (possibly server-side revoked) session cookie. */
  get signedIn(): boolean {
    return this.cookies.get(this.cookieName) !== undefined;
  }

  /** Any request as this user; the session cookie is attached. */
  request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.http.request<T>(options);
  }

  /**
   * Headers an event stream needs to authenticate as this user, read at
   * call time so a reconnect after a re-sign-in sends the new cookie.
   */
  streamHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const cookie = this.cookies.header();
    if (cookie !== '') {
      headers.cookie = cookie;
    }
    const forwardedFor = this.http.forwardedFor;
    if (forwardedFor !== undefined) {
      headers['x-forwarded-for'] = forwardedFor;
    }
    return headers;
  }

  async signIn(): Promise<SignInResult> {
    const response = await this.http.request<AuthBody>({
      method: 'POST',
      path: '/api/auth/sign-in/email',
      json: { email: this.email, password: this.password },
      name: 'POST /api/auth/sign-in/email',
    });
    const body = response.ok ? response.json() : undefined;
    const twoFactorRedirect = body?.twoFactorRedirect === true;
    const userId = stringOrUndefined(body?.user?.id);
    if (userId !== undefined) {
      this.userId = userId;
    }
    return {
      ok: response.ok && !twoFactorRedirect && this.signedIn,
      status: response.status,
      userId,
      ...(twoFactorRedirect ? { twoFactorRedirect } : {}),
    };
  }

  async signUp(name: string): Promise<AuthResult> {
    const response = await this.http.request<AuthBody>({
      method: 'POST',
      path: '/api/auth/sign-up/email',
      json: { name, email: this.email, password: this.password },
      name: 'POST /api/auth/sign-up/email',
    });
    const userId = response.ok
      ? stringOrUndefined(response.json()?.user?.id)
      : undefined;
    if (userId !== undefined) {
      this.userId = userId;
    }
    return {
      ok: response.ok && this.signedIn,
      status: response.status,
      userId,
    };
  }

  /** The server's view of the session; `ok` is false when it has none. */
  async getSession(): Promise<SessionInfo> {
    const response = await this.http.request<SessionBody | null>({
      method: 'GET',
      path: '/api/auth/get-session',
      name: 'GET /api/auth/get-session',
    });
    const body = response.ok ? response.json() : undefined;
    const userId = stringOrUndefined(body?.user?.id);
    return {
      ok: response.ok && userId !== undefined,
      status: response.status,
      userId,
      activeOrganizationId: stringOrUndefined(
        body?.session?.activeOrganizationId,
      ),
    };
  }

  async setActiveOrganization(orgId: string): Promise<AuthResult> {
    const response = await this.http.request({
      method: 'POST',
      path: '/api/auth/organization/set-active',
      json: { organizationId: orgId },
      name: 'POST /api/auth/organization/set-active',
    });
    if (response.ok) {
      this.orgId = orgId;
    }
    return { ok: response.ok, status: response.status, userId: this.userId };
  }

  async createOrganization(
    name: string,
    slug: string,
  ): Promise<CreatedOrganization> {
    const response = await this.http.request<OrganizationBody>({
      method: 'POST',
      path: '/api/auth/organization/create',
      json: { name, slug },
      name: 'POST /api/auth/organization/create',
    });
    const body = response.ok ? response.json() : undefined;
    return {
      ok: response.ok && stringOrUndefined(body?.id) !== undefined,
      status: response.status,
      id: stringOrUndefined(body?.id),
      slug: stringOrUndefined(body?.slug),
    };
  }

  /** Revoke the session server-side and drop it from the jar either way. */
  async signOut(): Promise<AuthResult> {
    const response = await this.http.request({
      method: 'POST',
      path: '/api/auth/sign-out',
      json: {},
      name: 'POST /api/auth/sign-out',
    });
    this.cookies.delete(this.cookieName);
    return { ok: response.ok, status: response.status, userId: this.userId };
  }

  /**
   * Act as the session whose raw token the seed wrote: sign it with the
   * deployment's auth secret exactly as Better Auth would and store it.
   */
  adoptSessionToken(token: string, secret: string): void {
    this.cookies.set(this.cookieName, signSessionToken(token, secret));
  }
}
