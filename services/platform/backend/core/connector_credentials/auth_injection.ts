/**
 * The pure core of credential injection: the plaintext payload each auth
 * method stores, the `Authorization` header the platform sends on the
 * caller's behalf, and the named secrets a live connector body reads through
 * `ctx.secrets.get(<name>)`.
 *
 * Kept V8-pure (no crypto, no fs, no Convex) so the wire format every live
 * connector call depends on is unit-testable without a deployment;
 * `resolve_credential.ts` is the `'use node'` seam that decrypts a row and
 * feeds this module.
 *
 * Two rules encode how the platform and the connector bodies split the work:
 *
 *  - The platform injects the header for `bearer`, `basic`, `oauth2`,
 *    `client-credentials` (the access token the platform fetched for the
 *    app, never the app's client secret), and `github-app` (the installation
 *    token the platform minted, never the app's private key). An
 *    `api-key` credential gets NO header — those vendors place the secret
 *    themselves (Tavily in the JSON body, Shopify in `X-Shopify-Access-Token`),
 *    so the body reads it from `secrets` instead.
 *  - Bodies address secrets by the VENDOR's vocabulary, which differs between
 *    connectors sharing one method (Tavily reads `apiKey`, Shopify reads
 *    `accessToken`, both `api-key`). One stored secret is therefore published
 *    under every name the shipped bodies use, with `token` as the canonical
 *    spelling — an alias costs nothing and beats forcing a vendor's body to
 *    rename its own concept.
 */

import { z } from 'zod/v4';

/** The scheme a `bearer` connector gets when its auth entry names none —
 * the same default `connectorAuthMethodSchema` applies. */
const DEFAULT_BEARER_SCHEME = 'Bearer';

/**
 * A decrypted `encryptedData` envelope, tagged with the row's `authMethod`.
 * The STORED JSON is untagged (`{ token }`, `{ username, password }`,
 * `{ accessToken, … }`, `{ clientId, clientSecret, … }`); the tag is added on parse so every
 * consumer switches exhaustively instead of sniffing fields.
 */
export type ConnectorSecretPayload =
  | { readonly authMethod: 'api-key' | 'bearer'; readonly token: string }
  | {
      readonly authMethod: 'basic';
      readonly username: string;
      readonly password: string;
      /**
       * Optional second login for connectors that send through a different
       * SMTP provider than they read mail from (Resend, SendGrid, SES, …).
       * Both fields are present together, or both absent — a half pair is
       * refused at parse time. IMAP keeps `username`/`password`.
       */
      readonly smtpUsername?: string;
      readonly smtpPassword?: string;
    }
  | {
      readonly authMethod: 'oauth2';
      readonly accessToken: string;
      readonly refreshToken?: string;
      readonly expiresAt?: number;
      readonly scopes?: readonly string[];
    }
  | {
      /**
       * An app that signs in as itself. The app's own registration is the
       * secret (`clientSecret`); `tenantId` is its directory, where the
       * connector's token URL names one. The last access token the
       * platform fetched rides along with its expiry, so a call within the
       * hour reuses it instead of asking the token endpoint again.
       */
      readonly authMethod: 'client-credentials';
      readonly tenantId?: string;
      readonly clientId: string;
      readonly clientSecret: string;
      readonly accessToken?: string;
      readonly expiresAt?: number;
    }
  | {
      /**
       * A GitHub App the organization registered from Tale's settings. Its
       * private key (`privateKey`, PEM) signs the JWT the platform trades
       * for an installation token; everything else is the app's public
       * identity, kept with the key so the one envelope says which app and
       * which installation the key is for. The last installation token
       * rides along with its expiry, as for `client-credentials`.
       */
      readonly authMethod: 'github-app';
      readonly appId: number;
      readonly clientId: string;
      readonly slug: string;
      readonly privateKey: string;
      /** The account (person or organization) that owns the app. */
      readonly owner?: string;
      /** The id of the app's bot user, `<slug>[bot]`, when GitHub told it. */
      readonly botId?: number;
      /** Where the app is installed; absent until someone installs it. */
      readonly installation?: GithubAppInstallation;
      readonly accessToken?: string;
      readonly expiresAt?: number;
    };

/** Where a GitHub App is installed, as GitHub reported it when it was
 * installed or its repositories last changed. */
export interface GithubAppInstallation {
  readonly id: number;
  /** The account the app is installed on. */
  readonly account: string;
  readonly accountType: 'User' | 'Organization';
  /** Every repository of the account, or the ones the installer chose. */
  readonly repositorySelection: 'all' | 'selected';
}

const tokenPayloadSchema = z.object({ token: z.string().min(1) }).strict();

const basicPayloadSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
    smtpUsername: z.string().min(1).optional(),
    smtpPassword: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.smtpUsername === undefined) === (value.smtpPassword === undefined),
    {
      message: 'smtpUsername and smtpPassword must both be set or both omitted',
      path: ['smtpPassword'],
    },
  );

const oauth2PayloadSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    /** Epoch ms the access token expires at, when the grant reported one. */
    expiresAt: z.number().optional(),
    scopes: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * A directory (tenant) id as it goes into a token URL's path: a GUID or a
 * verified domain name. Nothing that could leave the path segment (`/`,
 * `?`, `#`, `%`) passes, so a credential cannot point the client secret at
 * another endpoint of the same host.
 */
const TENANT_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

const clientCredentialsPayloadSchema = z
  .object({
    tenantId: z
      .string()
      .regex(TENANT_ID_RE, 'is a directory GUID or domain name')
      .optional(),
    clientId: z.string().min(1).max(256),
    clientSecret: z.string().min(1),
    accessToken: z.string().min(1).optional(),
    expiresAt: z.number().optional(),
  })
  .strict();

/** A GitHub App's slug: the lowercase name GitHub derived from the one the
 * admin chose, as it appears in `github.com/apps/<slug>`. */
export const GITHUB_APP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/** A private key as GitHub hands it out: one PEM block (PKCS#1 `RSA PRIVATE
 * KEY`, or PKCS#8 `PRIVATE KEY` once converted). */
const PRIVATE_KEY_PEM_RE =
  /^-----BEGIN (RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END \1PRIVATE KEY-----\s*$/;

const githubAppPayloadSchema = z
  .object({
    appId: z.number().int().positive(),
    clientId: z.string().min(1).max(256),
    slug: z.string().regex(GITHUB_APP_SLUG_RE, 'is a GitHub App slug'),
    privateKey: z.string().regex(PRIVATE_KEY_PEM_RE, 'is a PEM private key'),
    owner: z.string().min(1).max(100).optional(),
    botId: z.number().int().positive().optional(),
    installation: z
      .object({
        id: z.number().int().positive(),
        account: z.string().min(1).max(100),
        accountType: z.enum(['User', 'Organization']),
        repositorySelection: z.enum(['all', 'selected']),
      })
      .strict()
      .optional(),
    accessToken: z.string().min(1).optional(),
    expiresAt: z.number().optional(),
  })
  .strict();

/** Thrown for a payload that does not match its method — a row written by a
 * bad caller, or one whose method was changed under it. */
export class SecretPayloadError extends Error {
  /** The payload key the first issue is about, when it is one. */
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'SecretPayloadError';
    if (field !== undefined) this.field = field;
  }
}

/**
 * Validate a decrypted (or about-to-be-encrypted) payload against the method
 * it belongs to. Throws `SecretPayloadError` with the offending field named;
 * callers map that onto their own actionable refusal.
 */
export function parseSecretPayload(
  authMethod:
    | 'api-key'
    | 'bearer'
    | 'basic'
    | 'oauth2'
    | 'client-credentials'
    | 'github-app',
  raw: unknown,
): ConnectorSecretPayload {
  switch (authMethod) {
    case 'api-key':
    case 'bearer': {
      const parsed = tokenPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `A ${authMethod} credential stores { token }: ${issueOf(parsed.error)}`,
          fieldOf(parsed.error),
        );
      }
      return { authMethod, token: parsed.data.token };
    }
    case 'basic': {
      const parsed = basicPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `A basic credential stores { username, password }: ${issueOf(parsed.error)}`,
          fieldOf(parsed.error),
        );
      }
      return { authMethod, ...parsed.data };
    }
    case 'oauth2': {
      const parsed = oauth2PayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `An oauth2 credential stores { accessToken, refreshToken?, expiresAt?, scopes? }: ${issueOf(parsed.error)}`,
          fieldOf(parsed.error),
        );
      }
      return { authMethod, ...parsed.data };
    }
    case 'client-credentials': {
      const parsed = clientCredentialsPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `A client-credentials credential stores { tenantId?, clientId, clientSecret, accessToken?, expiresAt? }: ${issueOf(parsed.error)}`,
          fieldOf(parsed.error),
        );
      }
      return { authMethod, ...parsed.data };
    }
    case 'github-app': {
      const parsed = githubAppPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        // Never the issue's text: a key that fails its pattern would be
        // echoed into the message, and from there into a log.
        throw new SecretPayloadError(
          `A github-app credential stores { appId, clientId, slug, privateKey, owner?, botId?, installation?, accessToken?, expiresAt? }: ${fieldOf(parsed.error) ?? 'payload'} is invalid`,
          fieldOf(parsed.error),
        );
      }
      return { authMethod, ...parsed.data };
    }
    default: {
      const _exhaustive: never = authMethod;
      return _exhaustive;
    }
  }
}

/** The payload key the first zod issue is about, or `undefined` at the
 * root. */
function fieldOf(error: z.ZodError): string | undefined {
  const key = error.issues[0]?.path[0];
  return typeof key === 'string' ? key : undefined;
}

/** First zod issue as `path: message`, or a bare message at the root. */
function issueOf(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid payload';
  const path = issue.path.join('.');
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
}

/**
 * RFC 7617 wants the credentials base64'd from their UTF-8 bytes; `btoa`
 * alone throws on anything outside latin1, which a real password can hold.
 */
function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** How long before its expiry a GitHub App's installation token is no longer
 * sent: one with less left would die mid-call. */
const GITHUB_APP_TOKEN_SKEW_MS = 60_000;

/**
 * The `Authorization` header value the platform injects, or undefined when
 * the method carries no header. `bearerScheme` comes from the CONNECTOR's
 * `bearer` auth entry — `Bearer` for a PAT, `Bot` for a Discord bot token,
 * which rejects `Bearer` outright.
 *
 * A GitHub App's token is only ever minted and renewed by the credentials
 * domain's freshen seam, so one that is expired or expires within the
 * minute (at `nowMs`) was not freshened: it is refused with a
 * `SecretPayloadError` on `expiresAt` instead of being sent [CCRED-R18].
 */
export function buildAuthHeader(
  payload: ConnectorSecretPayload,
  bearerScheme: string = DEFAULT_BEARER_SCHEME,
  nowMs: number = Date.now(),
): string | undefined {
  switch (payload.authMethod) {
    // The vendor decides where an api key goes (query parameter, custom
    // header, JSON body); the body reads it from `secrets` and places it.
    case 'api-key':
      return undefined;
    case 'bearer':
      return `${bearerScheme} ${payload.token}`;
    case 'basic':
      return `Basic ${base64Utf8(`${payload.username}:${payload.password}`)}`;
    case 'oauth2':
      return `Bearer ${payload.accessToken}`;
    // The token the platform fetched for the app; none yet means the call
    // goes out unsigned and the vendor's refusal names it.
    case 'client-credentials':
      return payload.accessToken === undefined
        ? undefined
        : `Bearer ${payload.accessToken}`;
    case 'github-app':
      if (payload.accessToken === undefined) return undefined;
      if (
        payload.expiresAt === undefined ||
        payload.expiresAt - GITHUB_APP_TOKEN_SKEW_MS <= nowMs
      ) {
        throw new SecretPayloadError(
          'the GitHub App installation token is expired or expires within the minute — mint a new one before sending a call',
          'expiresAt',
        );
      }
      return `Bearer ${payload.accessToken}`;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

/**
 * What a live body reads via `ctx.secrets.get(<name>)`. Every name the
 * shipped connector bodies use must resolve here (see the module header):
 * `apiKey` (Tavily), `accessToken` (Shopify, and every oauth2 connector),
 * `username`/`password` (Twilio, Confluence, WebDAV, IMAP/SMTP), and
 * `smtpUsername`/`smtpPassword` when an IMAP/SMTP credential relays through a
 * separate SMTP provider. An app signing in as itself publishes only the
 * access token fetched for it: its client secret signs nothing but the
 * token request, which the platform makes. A GitHub App publishes nothing:
 * the platform signs each call with its installation token, and neither a
 * body nor a sandbox that reads these bindings ever holds that token or the
 * key that mints it.
 */
export function buildSecretBindings(
  payload: ConnectorSecretPayload,
): Record<string, string> {
  switch (payload.authMethod) {
    case 'api-key':
      return {
        token: payload.token,
        apiKey: payload.token,
        accessToken: payload.token,
      };
    case 'bearer':
      return { token: payload.token, accessToken: payload.token };
    case 'basic':
      return {
        username: payload.username,
        password: payload.password,
        ...(payload.smtpUsername !== undefined &&
          payload.smtpPassword !== undefined && {
            smtpUsername: payload.smtpUsername,
            smtpPassword: payload.smtpPassword,
          }),
      };
    case 'oauth2':
      return {
        token: payload.accessToken,
        accessToken: payload.accessToken,
        // The refresh flow reads it here: resolution is the only seam that
        // decrypts a row, so withholding it would leave no way to renew.
        ...(payload.refreshToken !== undefined && {
          refreshToken: payload.refreshToken,
        }),
      };
    case 'client-credentials':
      return payload.accessToken === undefined
        ? {}
        : { token: payload.accessToken, accessToken: payload.accessToken };
    case 'github-app':
      return {};
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
