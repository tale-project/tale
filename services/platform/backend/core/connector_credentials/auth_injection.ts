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
 *  - The platform injects the header for `bearer`, `basic`, and `oauth2`. An
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
export const DEFAULT_BEARER_SCHEME = 'Bearer';

/**
 * A decrypted `encryptedData` envelope, tagged with the row's `authMethod`.
 * The STORED JSON is untagged (`{ token }`, `{ username, password }`,
 * `{ accessToken, … }` — see `schema.ts`); the tag is added on parse so every
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
    };

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

/** Thrown for a payload that does not match its method — a row written by a
 * bad caller, or one whose method was changed under it. */
export class SecretPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretPayloadError';
  }
}

/**
 * Validate a decrypted (or about-to-be-encrypted) payload against the method
 * it belongs to. Throws `SecretPayloadError` with the offending field named;
 * callers map that onto their own actionable refusal.
 */
export function parseSecretPayload(
  authMethod: 'api-key' | 'bearer' | 'basic' | 'oauth2',
  raw: unknown,
): ConnectorSecretPayload {
  switch (authMethod) {
    case 'api-key':
    case 'bearer': {
      const parsed = tokenPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `A ${authMethod} credential stores { token }: ${issueOf(parsed.error)}`,
        );
      }
      return { authMethod, token: parsed.data.token };
    }
    case 'basic': {
      const parsed = basicPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `A basic credential stores { username, password }: ${issueOf(parsed.error)}`,
        );
      }
      return { authMethod, ...parsed.data };
    }
    case 'oauth2': {
      const parsed = oauth2PayloadSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SecretPayloadError(
          `An oauth2 credential stores { accessToken, refreshToken?, expiresAt?, scopes? }: ${issueOf(parsed.error)}`,
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

/**
 * The `Authorization` header value the platform injects, or undefined when
 * the method carries no header. `bearerScheme` comes from the CONNECTOR's
 * `bearer` auth entry — `Bearer` for a PAT, `Bot` for a Discord bot token,
 * which rejects `Bearer` outright.
 */
export function buildAuthHeader(
  payload: ConnectorSecretPayload,
  bearerScheme: string = DEFAULT_BEARER_SCHEME,
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
 * separate SMTP provider.
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
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
