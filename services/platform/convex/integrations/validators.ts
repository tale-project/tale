/**
 * Convex validators for integration operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const integrationTypeValidator = v.union(
  v.literal('rest_api'),
  v.literal('sql'),
  v.literal('imap_smtp'),
);

export const authMethodValidator = v.union(
  v.literal('api_key'),
  v.literal('bearer_token'),
  v.literal('basic_auth'),
  v.literal('oauth2'),
);

export const statusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
  v.literal('testing'),
);

export const operationTypeValidator = v.union(
  v.literal('read'),
  v.literal('write'),
);

export const sqlEngineValidator = v.union(
  v.literal('mssql'),
  v.literal('postgres'),
  v.literal('mysql'),
);

export const apiKeyAuthValidator = v.object({
  key: v.string(),
  keyPrefix: v.optional(v.string()),
});

export const apiKeyAuthEncryptedValidator = v.object({
  keyEncrypted: v.string(),
  keyPrefix: v.optional(v.string()),
});

export const basicAuthValidator = v.object({
  username: v.string(),
  password: v.string(),
});

export const basicAuthEncryptedValidator = v.object({
  username: v.string(),
  passwordEncrypted: v.string(),
});

/**
 * Optional second credential for the imap_smtp integration: the SMTP (sending)
 * login when it differs from the IMAP (receiving) login — e.g. IMAP = a private
 * mailbox, SMTP = Resend (`resend` + an API key). When absent, SMTP falls back
 * to `basicAuth`. Plaintext form (UI input).
 */
export const smtpAuthValidator = v.object({
  username: v.string(),
  password: v.string(),
});

/** Stored (encrypted-at-rest) form of {@link smtpAuthValidator}. */
export const smtpAuthEncryptedValidator = v.object({
  username: v.string(),
  passwordEncrypted: v.string(),
});

/** Per-account inbound routing target (mirrors the governance rule shape). */
const imapSmtpAccountRoutingValidator = v.object({
  teamId: v.optional(v.string()),
  userId: v.optional(v.string()),
});

/**
 * One real mailbox account under an imap_smtp integration. An integration may
 * hold several accounts; each has its own IMAP login, its own SMTP/relay target
 * (the mailbox's own SMTP, any relay, or a self-hosted submission host — the
 * design is provider-agnostic), its own From address, and its own routing.
 * Plaintext form (input to `saveCredentials`); the passwords are encrypted at
 * rest in {@link imapSmtpAccountEncryptedValidator}.
 */
export const imapSmtpAccountValidator = v.object({
  /** Stable id tying descriptor ↔ stored credentials ↔ conversation.accountId. */
  id: v.string(),
  /** Label shown in the inbox filter, compose picker and thread header. */
  displayName: v.optional(v.string()),
  /** The exact From / reply-from address for this account. */
  fromAddress: v.string(),
  imapHost: v.string(),
  imapPort: v.number(),
  imapSecure: v.boolean(),
  smtpHost: v.string(),
  smtpPort: v.number(),
  smtpSecure: v.boolean(),
  /** Sent-folder name to append copies to (discovered when omitted). */
  sentMailbox: v.optional(v.string()),
  saveSentToImap: v.optional(v.boolean()),
  /** The notifications/compose default account (at most one per integration). */
  isDefault: v.optional(v.boolean()),
  routing: v.optional(imapSmtpAccountRoutingValidator),
  /** IMAP (receiving) login. */
  imapAuth: basicAuthValidator,
  /** SMTP (sending) login when it differs from imapAuth; absent ⇒ reuse it. */
  smtpAuth: v.optional(smtpAuthValidator),
});

/** Stored (encrypted-at-rest) form of {@link imapSmtpAccountValidator}. */
export const imapSmtpAccountEncryptedValidator = v.object({
  id: v.string(),
  displayName: v.optional(v.string()),
  fromAddress: v.string(),
  imapHost: v.string(),
  imapPort: v.number(),
  imapSecure: v.boolean(),
  smtpHost: v.string(),
  smtpPort: v.number(),
  smtpSecure: v.boolean(),
  sentMailbox: v.optional(v.string()),
  saveSentToImap: v.optional(v.boolean()),
  isDefault: v.optional(v.boolean()),
  routing: v.optional(imapSmtpAccountRoutingValidator),
  imapAuth: basicAuthEncryptedValidator,
  smtpAuth: v.optional(smtpAuthEncryptedValidator),
});

export const oauth2AuthValidator = v.object({
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2AuthEncryptedValidator = v.object({
  accessTokenEncrypted: v.string(),
  refreshTokenEncrypted: v.optional(v.string()),
  tokenExpiry: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2ConfigValidator = v.object({
  authorizationUrl: v.string(),
  tokenUrl: v.string(),
  scopes: v.optional(v.array(v.string())),
});

export const oauth2ConfigStoredValidator = v.object({
  authorizationUrl: v.string(),
  tokenUrl: v.string(),
  scopes: v.optional(v.array(v.string())),
  clientId: v.optional(v.string()),
  clientSecretEncrypted: v.optional(v.string()),
  // Slack-only: app signing secret (encrypted) for inbound Events API
  // verification. Undefined for every other OAuth2 integration.
  signingSecretEncrypted: v.optional(v.string()),
});

/**
 * Connection config is integration-specific — each integration may store
 * custom fields (e.g. model, region) alongside standard ones (domain, timeout).
 * Use a flexible record validator to avoid rejecting unknown fields.
 */
export const connectionConfigValidator = v.any();

export const capabilitiesValidator = v.object({
  canSync: v.optional(v.boolean()),
  canPush: v.optional(v.boolean()),
  canWebhook: v.optional(v.boolean()),
  syncFrequency: v.optional(v.string()),
});

export const testConnectionResultValidator = v.object({
  success: v.boolean(),
  message: v.string(),
});

export const connectorOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  parametersSchema: v.optional(jsonRecordValidator),
  operationType: v.optional(operationTypeValidator),
  requiresApproval: v.optional(v.boolean()),
  requiredScopes: v.optional(v.array(v.string())),
});

export const connectorConfigValidator = v.object({
  code: v.string(),
  version: v.number(),
  operations: v.array(connectorOperationValidator),
  secretBindings: v.array(v.string()),
  allowedHosts: v.optional(v.array(v.string())),
  timeoutMs: v.optional(v.number()),
});

const sqlConnectionOptionsValidator = v.object({
  encrypt: v.optional(v.boolean()),
  trustServerCertificate: v.optional(v.boolean()),
  connectionTimeout: v.optional(v.number()),
  requestTimeout: v.optional(v.number()),
});

const sqlSecurityValidator = v.object({
  maxResultRows: v.optional(v.number()),
  queryTimeoutMs: v.optional(v.number()),
  maxConnectionPoolSize: v.optional(v.number()),
});

export const sqlConnectionConfigValidator = v.object({
  engine: sqlEngineValidator,
  server: v.optional(v.string()),
  port: v.optional(v.number()),
  database: v.optional(v.string()),
  readOnly: v.optional(v.boolean()),
  options: v.optional(sqlConnectionOptionsValidator),
  security: v.optional(sqlSecurityValidator),
});

export const sqlOperationValidator = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  query: v.string(),
  parametersSchema: v.optional(jsonRecordValidator),
  operationType: v.optional(operationTypeValidator),
  requiresApproval: v.optional(v.boolean()),
  requiredScopes: v.optional(v.array(v.string())),
});
