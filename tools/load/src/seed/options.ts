/**
 * Seed options: what population to build, against which deployment, and how
 * hard to push while building it.
 *
 * Two identity-defining options, `runId` and `password`, deliberately carry
 * NO schema default: a resumed seed must take both from the plan it resumes
 * (every user row already holds that password's hash, every e-mail that run
 * id), so the defaults are applied by {@link resolveRunIdentity} once the
 * seed knows whether it resumes. Everything else defaults here.
 */

import { randomInt } from 'node:crypto';

import { z } from 'zod';

/** Characters a generated password draws from, by policy class. */
const PASSWORD_CLASSES = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghijkmnopqrstuvwxyz',
  digit: '23456789',
  special: '!#%+-=@_',
} as const;

/** Length of a generated password; the plan schema's floor is 12. */
const GENERATED_PASSWORD_LENGTH = 20;

/**
 * Whether `password` meets the policy every seeded password follows: at
 * least 12 characters with an upper-case letter, a lower-case letter, a digit
 * and a special character. Deployments with a stricter org password policy
 * still accept seeded users (SQL rows bypass the form), but sign-up over HTTP
 * and any later password change are held to the deployment's own rule.
 */
export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= 12 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

/**
 * A fresh random password meeting {@link meetsPasswordPolicy}: one character
 * of each class, the rest from all of them, shuffled with a CSPRNG so the
 * class positions are not predictable either.
 */
export function generatePassword(): string {
  const all = Object.values(PASSWORD_CLASSES).join('');
  const pick = (alphabet: string): string =>
    alphabet.charAt(randomInt(alphabet.length));
  const chars = Object.values(PASSWORD_CLASSES).map(pick);
  while (chars.length < GENERATED_PASSWORD_LENGTH) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const swap = chars[i] ?? '';
    chars[i] = chars[j] ?? '';
    chars[j] = swap;
  }
  return chars.join('');
}

/** A fresh run id: 8 lower-case alphanumerics, as the plan schema expects. */
export function randomRunId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i += 1) id += alphabet.charAt(randomInt(36));
  return id;
}

const runIdSchema = z.string().regex(/^[a-z0-9]{4,16}$/);

/**
 * Vector widths the platform's knowledge database has tables for; an
 * embedding config naming any other width is refused on save. A copy of
 * `KNOWLEDGE_VECTOR_WIDTHS` (runtime code cannot load the shared package),
 * held equal to it by a unit test.
 */
export const EMBEDDING_WIDTHS = [
  256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096,
] as const;

/** The mock provider every seeded organization is wired to. */
export const seedProviderSchema = z.object({
  /** Provider slug; also the org-custom definition's file name. */
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(64)
    .default('loadmock'),
  /** OpenAI-compatible base URL of the mock (the platform appends paths). */
  baseUrl: z.string().url().default('http://127.0.0.1:4199/v1'),
  /** The env credential's variable; the backend must define it. */
  envName: z
    .string()
    .max(40)
    .regex(/^TALE_PROVIDER_KEY_[A-Za-z0-9_]+$/)
    .default('TALE_PROVIDER_KEY_LOADMOCK'),
  apiFormat: z.enum(['openai', 'anthropic']).default('openai'),
  chatModel: z.string().min(1).default('load-chat-fast'),
  embeddingModel: z.string().min(1).default('load-embed'),
  embeddingDimensions: z
    .number()
    .int()
    .refine(
      (width) => (EMBEDDING_WIDTHS as readonly number[]).includes(width),
      {
        message:
          'must be a vector width the knowledge database has a table for',
      },
    )
    .default(1536),
  /**
   * Where the platform learns the provider's models. `models-endpoint` (the
   * default) lists `GET <baseUrl>/models`, so the mock's catalog, pricing
   * included, is what the composer offers; `none` makes the credential's
   * allowlist (the chat model alone) the catalog, which needs no mock while
   * seeding but books every turn at price 0.
   */
  catalogSource: z.enum(['models-endpoint', 'none']).default('models-endpoint'),
});

export type SeedProvider = z.infer<typeof seedProviderSchema>;

export const seedOptionsSchema = z
  .object({
    /** Base URL of the deployment (its SITE_URL origin, normally). */
    target: z
      .string()
      .url()
      .transform((value) => value.replace(/\/+$/, '')),
    /**
     * `Origin` every non-GET request carries; Better Auth refuses a cookie
     * request from an origin it does not trust. Defaults to the target's.
     */
    origin: z.string().url().optional(),
    /** App database URL. Absent: the whole seed runs over HTTP. */
    dbUrl: z.string().min(1).optional(),
    /**
     * The deployment's BETTER_AUTH_SECRET. With `dbUrl` it lets the seed
     * mint one session per user; alone it means nothing.
     */
    authSecret: z.string().min(1).optional(),
    users: z.number().int().min(1).max(50_000_000),
    orgSize: z.number().int().min(1),
    megaOrgSize: z.number().int().min(0).default(0),
    /** See the module comment: defaulted by `resolveRunIdentity`. */
    runId: runIdSchema.optional(),
    /** See the module comment: defaulted by `resolveRunIdentity`. */
    password: z
      .string()
      .refine(meetsPasswordPolicy, {
        message:
          'must be at least 12 characters with an upper-case letter, a lower-case letter, a digit and a special character',
      })
      .optional(),
    emailDomain: z
      .string()
      .min(3)
      .regex(/^[a-z0-9.-]+$/)
      .default('load.tale.invalid'),
    provider: seedProviderSchema.prefault({}),
    /** In-flight HTTP requests. */
    concurrency: z.number().int().min(1).max(1024).default(16),
    /** Rows per multi-row INSERT; Postgres caps a statement at 65535 binds. */
    batchSize: z.number().int().min(1).max(5000).default(2000),
    /** SQL batches in flight at once. */
    sqlParallelism: z.number().int().min(1).max(32).default(4),
    /** Where the plan is written. */
    output: z.string().min(1).default('load-plan.json'),
    /** Reuse the plan at `output` (run id, password) and skip what it lists. */
    resume: z.boolean().default(false),
    /**
     * A synthetic per-user `X-Forwarded-For` prefix (`10.77`, `10`) for
     * password sign-ins, so the per-IP sign-in limit (30/min) sees many
     * clients. Only honoured when the backend trusts the seeding host as a
     * proxy, which loopback and private peers are by default.
     */
    forwardedForBase: z
      .string()
      .regex(/^\d{1,3}(?:\.\d{1,3}){0,2}$/)
      .optional(),
    /** How long one organization may wait for its scaffold job. */
    scaffoldTimeoutMs: z.number().int().min(0).default(120_000),
  })
  .superRefine((options, ctx) => {
    if (options.megaOrgSize > options.users) {
      ctx.addIssue({
        code: 'custom',
        path: ['megaOrgSize'],
        message: `cannot exceed users (${options.users})`,
      });
    }
  });

export type SeedOptionsInput = z.input<typeof seedOptionsSchema>;
export type SeedOptions = z.output<typeof seedOptionsSchema>;

/** Parse and default seed options; throws a readable error on bad input. */
export function parseSeedOptions(input: SeedOptionsInput): SeedOptions {
  const parsed = seedOptionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid seed options: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Block organizations a population needs; a partial last block is one. */
export function blockOrganizationCount(users: number, orgSize: number): number {
  return Math.ceil(users / orgSize);
}

/**
 * The run id and password the seed uses: a resumed plan's (an explicit
 * option that disagrees is an error, not a silent override), else the
 * options', else fresh ones.
 */
export function resolveRunIdentity(
  options: Pick<SeedOptions, 'runId' | 'password'>,
  resumed: { runId: string; password: string } | null,
): { runId: string; password: string } {
  if (resumed) {
    if (options.runId !== undefined && options.runId !== resumed.runId) {
      throw new Error(
        `--run-id ${options.runId} disagrees with the resumed plan's ${resumed.runId}`,
      );
    }
    if (
      options.password !== undefined &&
      options.password !== resumed.password
    ) {
      throw new Error(
        'The password disagrees with the resumed plan: seeded users already hold its hash',
      );
    }
    return resumed;
  }
  return {
    runId: options.runId ?? randomRunId(),
    password: options.password ?? generatePassword(),
  };
}

/**
 * The synthetic IPv4 address of virtual user `index` under `base` (one to
 * three octets); the remaining octets are the index's low bytes, so up to
 * 16.7 M users get distinct addresses under a one-octet base.
 */
export function syntheticIp(base: string, index: number): string {
  const head = base.split('.');
  const tail: number[] = [];
  for (let octet = 4 - head.length - 1; octet >= 0; octet -= 1) {
    tail.push((index >>> (8 * octet)) & 255);
  }
  return [...head, ...tail.map(String)].join('.');
}
