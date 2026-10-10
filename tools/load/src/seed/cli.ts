/**
 * `seed` as a command: `createSeedCommand()` for the harness CLI to mount,
 * and a direct entry point (`node src/seed/cli.ts …`). The database URL and
 * the auth secret are read from the environment by default so they never
 * appear in a process listing.
 */

import { pathToFileURL } from 'node:url';

import { Command, InvalidArgumentError, Option } from 'commander';

import { runSeedWithReport } from './run-seed.ts';

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a non-negative integer');
  }
  return parsed;
}

interface SeedCliOptions {
  target: string;
  origin?: string;
  dbUrl?: string;
  authSecret?: string;
  users: number;
  orgSize: number;
  megaOrgSize: number;
  runId?: string;
  password?: string;
  emailDomain?: string;
  providerSlug?: string;
  providerBaseUrl?: string;
  providerEnvName?: string;
  providerApiFormat?: 'openai' | 'anthropic';
  chatModel?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  catalogSource?: 'models-endpoint' | 'none';
  concurrency?: number;
  batchSize?: number;
  sqlParallelism?: number;
  output?: string;
  resume?: boolean;
  forwardedForBase?: string;
  scaffoldTimeoutMs?: number;
}

/** Drop `undefined` entries so the option schema's defaults apply. */
function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

export function createSeedCommand(): Command {
  return new Command('seed')
    .description(
      'Seed users, organizations and memberships for a load run, and write the plan file',
    )
    .requiredOption('--target <url>', 'base URL of the deployment')
    .option('--origin <url>', 'Origin header for writes (default: the target)')
    .addOption(
      new Option(
        '--db-url <url>',
        'app database URL (absent: HTTP-only seed)',
      ).env('TALE_LOAD_DB_URL'),
    )
    .addOption(
      new Option(
        '--auth-secret <secret>',
        'BETTER_AUTH_SECRET, to mint sessions',
      ).env('TALE_LOAD_AUTH_SECRET'),
    )
    .requiredOption('--users <n>', 'virtual users', integer)
    .requiredOption('--org-size <n>', 'users per block organization', integer)
    .option(
      '--mega-org-size <n>',
      'users also in one large organization',
      integer,
      0,
    )
    .option('--run-id <id>', 'seed identity (default: random)')
    .addOption(
      new Option('--password <password>', 'password of every user').env(
        'TALE_LOAD_PASSWORD',
      ),
    )
    .option('--email-domain <domain>', 'e-mail domain of every user')
    .option('--provider-slug <slug>', 'mock provider slug')
    .option('--provider-base-url <url>', 'mock provider base URL')
    .option('--provider-env-name <name>', 'env variable of the credential')
    .addOption(
      new Option(
        '--provider-api-format <format>',
        'wire format of the mock provider',
      ).choices(['openai', 'anthropic']),
    )
    .option('--chat-model <id>', 'chat model id')
    .option('--embedding-model <id>', 'embedding model id')
    .option('--embedding-dimensions <n>', 'embedding width', integer)
    .addOption(
      new Option(
        '--catalog-source <source>',
        'where the platform lists models',
      ).choices(['models-endpoint', 'none']),
    )
    .option('--concurrency <n>', 'HTTP requests in flight', integer)
    .option('--batch-size <n>', 'rows per INSERT', integer)
    .option('--sql-parallelism <n>', 'SQL batches in flight', integer)
    .option('--output <file>', 'plan file', 'load-plan.json')
    .option('--resume', 'continue the plan at --output')
    .option('--forwarded-for-base <prefix>', 'synthetic X-Forwarded-For prefix')
    .option('--scaffold-timeout-ms <ms>', 'per-org scaffold wait', integer)
    .addHelpText(
      'after',
      '\nDefaults, the order of work and resume semantics: the comment at the top of tools/load/src/seed/run-seed.ts.',
    )
    .action(async (cli: SeedCliOptions) => {
      const report = await runSeedWithReport(
        defined({
          target: cli.target,
          origin: cli.origin,
          dbUrl: cli.dbUrl,
          authSecret: cli.authSecret,
          users: cli.users,
          orgSize: cli.orgSize,
          megaOrgSize: cli.megaOrgSize,
          runId: cli.runId,
          password: cli.password,
          emailDomain: cli.emailDomain,
          provider: defined({
            slug: cli.providerSlug,
            baseUrl: cli.providerBaseUrl,
            envName: cli.providerEnvName,
            apiFormat: cli.providerApiFormat,
            chatModel: cli.chatModel,
            embeddingModel: cli.embeddingModel,
            embeddingDimensions: cli.embeddingDimensions,
            catalogSource: cli.catalogSource,
          }),
          concurrency: cli.concurrency,
          batchSize: cli.batchSize,
          sqlParallelism: cli.sqlParallelism,
          output: cli.output,
          resume: cli.resume,
          forwardedForBase: cli.forwardedForBase,
          scaffoldTimeoutMs: cli.scaffoldTimeoutMs,
        }) as Parameters<typeof runSeedWithReport>[0],
      );
      if (report.failures.length > 0) process.exitCode = 1;
    });
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  createSeedCommand()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      // The message is the operator's answer; the stack only when asked.
      const detail =
        error instanceof Error
          ? process.env.TALE_LOAD_DEBUG === '1'
            ? (error.stack ?? error.message)
            : error.message
          : String(error);
      console.error(`[seed] failed: ${detail}`);
      process.exitCode = 1;
    });
}
