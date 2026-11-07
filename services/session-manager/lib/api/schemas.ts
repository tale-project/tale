// The HTTP API of the session manager: request and response bodies, shared by
// the backend routes, the MCP tools and the React client. Property names are
// camelCase; the values of a status, an activity and an error code are the
// stable lower_snake identifiers a client can switch on.
//
// Errors are answered as `{ error: <code>, message, ...extra }` (ApiErrorBody).

import { z } from 'zod';

import '../zod-config.ts';
import { MAX_PROXY_IMPORT, MAX_PROXY_LINE } from '../proxy-limits.ts';
import {
  longerThan,
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '../secret-limits.ts';
import { SESSION_NAME_MAX_LENGTH } from '../session-name.ts';

/** The largest id a row can have (JSON numbers are doubles). */
export const MAX_ID = Number.MAX_SAFE_INTEGER;

export const idSchema = z.number().int().min(1).max(MAX_ID);

export const SCHEMES = ['http', 'https', 'socks5'] as const;
export const schemeSchema = z.enum(SCHEMES);
export type Scheme = z.infer<typeof schemeSchema>;

export const OS_CHOICES = ['random', 'windows', 'macos', 'linux'] as const;
export const osChoiceSchema = z.enum(OS_CHOICES);
export type OsChoice = z.infer<typeof osChoiceSchema>;

export const SESSION_STATUSES = [
  'stopped',
  'starting',
  'running',
  'stopping',
  'error',
] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** What a session's background work is doing right now. */
const SESSION_ACTIVITIES = ['assigning_proxy', 'launching'] as const;
export const sessionActivitySchema = z.enum(SESSION_ACTIVITIES);
export type SessionActivity = z.infer<typeof sessionActivitySchema>;

const CHECK_STATUSES = ['unchecked', 'checking', 'ok', 'failed'] as const;
export const checkStatusSchema = z.enum(CHECK_STATUSES);
export type CheckStatus = z.infer<typeof checkStatusSchema>;

export const SECRET_KINDS = [
  'personal',
  'credentials',
  'card',
  'note',
] as const;
export const secretKindSchema = z.enum(SECRET_KINDS);
export type SecretKind = z.infer<typeof secretKindSchema>;

// -- errors ------------------------------------------------------------------

/**
 * The extra fields of some codes name what the page words the code with (the
 * `message` stays the English sentence, for API and MCP clients):
 *
 * - `proxy_unreachable`: `proxyId`, and `reason`, the proxy check's own words
 *   for the cause (no sentence around it);
 * - `session_busy`: `doing`, what the session is doing: `assigning_proxy`,
 *   `starting` or `stopping` (missing when it is busy with anything else).
 *
 * Two codes only ever come with a session that failed in the background, not
 * as an answer: `no_working_proxy` (`failed`, how many proxies failed their
 * check, only when some did) and `unknown_ip_location` (`reason`, as above). A
 * session that failed with any of these three codes carries the same fields
 * as its `errorExtra`.
 */
export interface ApiErrorBody extends Record<string, unknown> {
  /** The stable machine-readable code. */
  error: string;
  /** A sentence for the person using the app. */
  message: string;
}

// -- requests ----------------------------------------------------------------

/** The longest web address of a setting. */
const MAX_START_PAGE = 2048;

/**
 * How many times a limit a text can be before the schemas refuse it. The exact
 * limits of a session's name and a secret are rules of the server: it trims
 * the text first and answers with a code of its own (`invalid_name`,
 * `invalid_secret`), so a text near the limit must still reach them. This
 * only stops what is absurdly more before anything looks at it. Two, for a
 * character of two UTF-16 units, is the least that never refuses what the
 * rule takes; the rest is room for blanks around the text.
 */
const ROOM = 4;

/** A text of at most `limit` characters, counted as a person counts them. */
function atMost(limit: number) {
  return z
    .string()
    .refine(
      (text) => !longerThan(text, limit),
      `Too big: expected at most ${limit} characters`,
    );
}

/** A text of no more than `ROOM` times `limit` UTF-16 units: see `ROOM`. */
function roomyFor(limit: number) {
  return z
    .string()
    .refine(
      (text) => text.length <= limit * ROOM,
      `Too big: expected at most ${limit} characters`,
    );
}

export const proxyCreateSchema = z.object({
  proxy: atMost(MAX_PROXY_LINE),
  defaultScheme: schemeSchema.default('http'),
});
export type ProxyCreate = z.infer<typeof proxyCreateSchema>;

/** The proxies of an import: one per line. */
export const proxyListSchema = atMost(MAX_PROXY_IMPORT);

export const proxyImportSchema = z.object({
  text: proxyListSchema,
  defaultScheme: schemeSchema.default('http'),
});
export type ProxyImport = z.infer<typeof proxyImportSchema>;

/** The name of a session, as far as the schemas look at it (the rules are the server's). */
export const sessionNameSchema = roomyFor(SESSION_NAME_MAX_LENGTH);

export const sessionCreateSchema = z.object({
  /** Blank or missing: the next free number, "0001", "0002", … */
  name: sessionNameSchema.nullish(),
  os: osChoiceSchema.default('random'),
});
export type SessionCreate = z.infer<typeof sessionCreateSchema>;

export const sessionUpdateSchema = z.object({ name: sessionNameSchema });

export const startRequestSchema = z.object({
  /** Start even if another active session has the same exit IP. */
  force: z.boolean().default(false),
});

/**
 * What the page types into the window of a session, where its focus is: a
 * value of a secret, so no more than the longest one.
 */
export const typeTextSchema = z.object({
  text: atMost(MAX_VALUE).refine((text) => text !== '', 'Nothing to type'),
});

/** The address of the start page. */
export const startPageSchema = atMost(MAX_START_PAGE);

export const settingsUpdateSchema = z.object({
  /** Blank: the default. */
  startPage: startPageSchema.nullish(),
  mcpEnabled: z.boolean().nullish(),
});
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

/** The title of a secret, as far as the schemas look at it (the rules are the vault's). */
export const secretTitleSchema = roomyFor(MAX_TITLE);

/** The label of a value of a secret, likewise. */
export const secretLabelSchema = roomyFor(MAX_LABEL);

export const secretFieldInSchema = z.object({
  label: secretLabelSchema,
  value: roomyFor(MAX_VALUE).default(''),
  /** Missing: masked if the kind of secret masks this label. */
  hidden: z.boolean().nullish(),
});
export type SecretFieldIn = z.infer<typeof secretFieldInSchema>;

/** The rows of a secret. The vault counts the rows that have a value; this only stops absurd lists. */
export const secretFieldsSchema = z
  .array(secretFieldInSchema)
  .refine(
    (rows) => rows.length <= MAX_FIELDS * ROOM,
    `Too big: expected at most ${MAX_FIELDS} values`,
  );

export const secretCreateSchema = z.object({
  kind: secretKindSchema,
  title: secretTitleSchema,
  /** Missing or null: for every session. */
  sessionId: idSchema.nullish(),
  fields: secretFieldsSchema,
});
export type SecretCreate = z.infer<typeof secretCreateSchema>;

/**
 * Only what is sent changes. `sessionId: null` makes the secret one for every
 * session, so a handler tells "missing" from "null" with `'sessionId' in body`.
 */
export const secretUpdateSchema = z.object({
  title: secretTitleSchema.optional(),
  sessionId: idSchema.nullable().optional(),
  fields: secretFieldsSchema.optional(),
});
export type SecretUpdate = z.infer<typeof secretUpdateSchema>;

/**
 * The part of a list a client asks for, newest (highest id) first: at most
 * `limit` rows, the ids below `before` (the next page), the ids from `minId`
 * up (a refresh of the loaded rows and the newer ones). None of them: the
 * whole list. The `X-Total-Count` header has the size of the whole list.
 */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.coerce.number().int().min(1).max(MAX_ID).optional(),
  minId: z.coerce.number().int().min(1).max(MAX_ID).optional(),
});

// -- responses ---------------------------------------------------------------

export const sessionRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: sessionStatusSchema,
});
export type SessionRef = z.infer<typeof sessionRefSchema>;

export const settingsSchema = z.object({
  startPage: z.string(),
  defaultStartPage: z.string(),
  mcpEnabled: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

export const secretFieldSchema = z.object({
  label: z.string(),
  value: z.string(),
  hidden: z.boolean(),
});
export type SecretField = z.infer<typeof secretFieldSchema>;

/** What lists show: no masked value. */
export const secretSummarySchema = z.object({
  id: idSchema,
  kind: secretKindSchema,
  title: z.string(),
  /** The session it belongs to; null: for every session. */
  session: sessionRefSchema.nullable(),
  preview: z.string(),
  updatedAt: z.string(),
});
export type SecretSummary = z.infer<typeof secretSummarySchema>;

export const secretSchema = secretSummarySchema.extend({
  fields: z.array(secretFieldSchema),
  createdAt: z.string(),
});
export type Secret = z.infer<typeof secretSchema>;

export const fieldSpecSchema = z.object({
  label: z.string(),
  hidden: z.boolean(),
  multiline: z.boolean(),
});
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const secretKindInfoSchema = z.object({
  key: secretKindSchema,
  label: z.string(),
  /** What a new secret of this kind starts with. */
  fields: z.array(fieldSpecSchema),
});
export type SecretKindInfo = z.infer<typeof secretKindInfoSchema>;

export const proxyCheckSchema = z.object({
  status: checkStatusSchema,
  ok: z.boolean().nullable(),
  exitIp: z.string().nullable(),
  country: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ProxyCheckResult = z.infer<typeof proxyCheckSchema>;

export const proxySchema = z.object({
  id: idSchema,
  scheme: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string().nullable(),
  /** The API never returns a password. */
  hasPassword: z.boolean(),
  /** `scheme://host:port`, without credentials. */
  display: z.string(),
  createdAt: z.string(),
  check: proxyCheckSchema,
  /** The session that has the proxy (or is being assigned it). */
  session: sessionRefSchema.nullable(),
  /**
   * Without a session: the session that has another proxy with the same exit
   * IP, so this one is not assigned.
   */
  sameIpAs: sessionRefSchema.nullable(),
});
export type Proxy = z.infer<typeof proxySchema>;

export const importDuplicateSchema = z.object({
  line: z.number().int(),
  display: z.string(),
  existingId: idSchema,
});
export type ImportDuplicate = z.infer<typeof importDuplicateSchema>;

/** The values a message names, for a translation to put in its own sentence. */
export const messageParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number()]),
);
export type MessageParams = z.infer<typeof messageParamsSchema>;

export const importLineErrorSchema = z.object({
  line: z.number().int(),
  /** Masked: host and port only. */
  input: z.string(),
  /** English, for API clients; the app words the error from `code`. */
  message: z.string(),
  /** Stable snake_case identifier of the reason, e.g. `missing_port`. */
  code: z.string(),
  params: messageParamsSchema,
});
export type ImportLineError = z.infer<typeof importLineErrorSchema>;

export const importResultSchema = z.object({
  added: z.array(proxySchema),
  duplicates: z.array(importDuplicateSchema),
  errors: z.array(importLineErrorSchema),
  summary: z.string(),
});
export type ImportResult = z.infer<typeof importResultSchema>;

/**
 * One proxy of the sub2api proxy file. This is an external file format, so its
 * keys stay snake_case. Username and password are left out when the proxy has
 * none.
 */
export const exportedProxySchema = z.object({
  /** protocol|host|port|username|password */
  proxy_key: z.string(),
  name: z.string(),
  protocol: z.string(),
  host: z.string(),
  port: z.number().int(),
  username: z.string().optional(),
  password: z.string().optional(),
  status: z.literal('active'),
  fallback_mode: z.literal('none'),
  expiry_warn_days: z.literal(7),
});
export type ExportedProxy = z.infer<typeof exportedProxySchema>;

export const proxyExportSchema = z.object({
  /** UTC, e.g. 2026-10-31T12:59:23Z */
  exported_at: z.string(),
  proxies: z.array(exportedProxySchema),
  /** Always empty: the app has no accounts. */
  accounts: z.array(z.record(z.string(), z.unknown())),
});
export type ProxyExport = z.infer<typeof proxyExportSchema>;

const sessionProxySchema = z.object({
  id: idSchema,
  display: z.string(),
  exitIp: z.string().nullable(),
  country: z.string().nullable(),
  checkStatus: checkStatusSchema,
});

const fingerprintSummarySchema = z.object({
  userAgent: z.string().nullable(),
  platform: z.string().nullable(),
  screen: z.string().nullable(),
  gpu: z.string().nullable(),
  locale: z.string().nullable(),
  timezone: z.string().nullable(),
});

/**
 * The place a session reports: its timezone and geolocation, those of the exit
 * IP it started with.
 */
export const locationSchema = z.object({
  ip: z.string(),
  country: z.string().nullable(),
  timezone: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  /**
   * While it runs: does its proxy still exit through that IP? Null: not
   * known.
   */
  inSync: z.boolean().nullable(),
});
export type SessionLocation = z.infer<typeof locationSchema>;

export const sessionSchema = z.object({
  id: idSchema,
  name: z.string(),
  os: z.string(),
  status: sessionStatusSchema,
  activity: sessionActivitySchema.nullable(),
  error: z.string().nullable(),
  errorCode: z.string().nullable(),
  /**
   * What the page words `errorCode` with besides the code: the cause
   * (`reason`) of a proxy that does not answer or an exit IP without a place,
   * how many proxies failed their check (`failed`). The keys are those the
   * refusal of the same code answers with (see `ApiErrorBody`). Null: none.
   */
  errorExtra: messageParamsSchema.nullable(),
  proxy: sessionProxySchema.nullable(),
  fingerprint: fingerprintSummarySchema,
  location: locationSchema.nullable(),
  createdAt: z.string(),
  lastStartedAt: z.string().nullable(),
});
export type Session = z.infer<typeof sessionSchema>;

export const countsSchema = z.object({
  proxies: z.number().int(),
  /** Assignable: not used by a session, not failed, no exit IP in use. */
  freeProxies: z.number().int(),
  failedProxies: z.number().int(),
  checkingProxies: z.number().int(),
  sessions: z.number().int(),
  running: z.number().int(),
  secrets: z.number().int(),
});
export type Counts = z.infer<typeof countsSchema>;

/** How far the app has come with installing the browser. */
export const installProgressSchema = z.object({
  /** Downloading the archive, then checking and unpacking it. */
  phase: z.enum(['downloading', 'unpacking']),
  /** How much of the archive is in, 0 to 100; null until the download says. */
  percent: z.number().int().min(0).max(100).nullable(),
});
export type InstallProgress = z.infer<typeof installProgressSchema>;

export const metaSchema = z.object({
  version: z.string(),
  /** The version of the Camoufox browser build this release works with. */
  browserVersion: z.string(),
  browserInstalled: z.boolean(),
  /** The app is downloading the browser itself. */
  browserInstalling: z.boolean(),
  /** How far that has come; null when no install is under way. */
  browserInstallProgress: installProgressSchema.nullable(),
  /** Why that failed: the browser has to be installed by hand. */
  browserInstallError: z.string().nullable(),
  osOptions: z.array(z.string()),
  secretKinds: z.array(secretKindInfoSchema),
  nextSessionName: z.string(),
  counts: countsSchema,
});
export type Meta = z.infer<typeof metaSchema>;
