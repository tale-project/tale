import type { Sql } from 'postgres';

/**
 * The writer mutex every org-config WRITE holds — one Postgres advisory
 * transaction lock per `(org, domain)` directory of the config store.
 *
 * The config store is files, and `atomicWrite` makes a single file's
 * replacement atomic — temp file, fsync, rename. What it cannot do is make a
 * READ-MODIFY-WRITE atomic, and nearly every config write is one: read the
 * current file, snapshot it into `.history/`, prune the trail, write the new
 * content, delete a superseded sibling. Two writers interleaving there lose
 * an update or strand a half-written pair — the SSO connection is two files
 * (`connection.yml` + `connection.secrets.json`) that must move together, and
 * a deployment that commits one writer's config against the other's secrets
 * authenticates against its identity provider with a mismatched pair.
 *
 * A per-process mutex cannot cover this: the api and the worker have always
 * both mounted the store read-write, and a colour flip runs two api replicas
 * at once. The database is the one thing every writer shares, so the lock
 * lives there — and on `pg_advisory_xact_lock` rather than a lock file, so a
 * deployment that moves the config volume onto a network filesystem keeps
 * working.
 *
 * The skill bundle swap holds a FINER lock of the same shape
 * (`domains/skills/writer-lock.ts`, per `(org, slug)`); a caller that needs
 * both takes this one first, so the acquisition order is always
 * domain-then-entry and two writers cannot deadlock.
 */

/**
 * The config-store directories a write serializes on. These are the domain
 * folder names under `$TALE_CONFIG_DIR/<org>/`, so the lock's granularity is
 * exactly the granularity of the files it protects. SSO lives under
 * `governance/sso/`, so it shares the governance domain's lock.
 */
export type ConfigDomain =
  | 'agents'
  | 'branding'
  | 'governance'
  | 'knowledge'
  | 'object-storage'
  | 'skills'
  /** The whole org subtree — held by the scaffolder, which writes every
   *  domain at once. */
  | 'org'
  /** The deployment-scoped `deployment.yml` at the config root, which has no
   *  org (see {@link DEPLOYMENT_CONFIG_SCOPE}). */
  | 'deployment';

/**
 * The org slug the deployment-scoped config file (`<configRoot>/
 * deployment.yml`) locks under. It has no organization, and a real slug can
 * never be empty (`isValidOrgSlug`), so this key is unreachable from the
 * per-org space.
 */
export const DEPLOYMENT_CONFIG_SCOPE = '';

export function configWriteLockKey(
  orgSlug: string,
  domain: ConfigDomain,
): string {
  return `config:${orgSlug}:${domain}`;
}

/**
 * Whether this handle can open a transaction of its own.
 *
 * postgres.js gives the ROOT `sql` a `begin` and a transaction handle a
 * `savepoint` — never both, even though `TransactionSql extends Sql` claims
 * otherwise in the types. The distinction is load-bearing here:
 * `pg_advisory_xact_lock` is released at the end of the transaction that
 * took it, and a statement run on the root handle is its own implicit
 * transaction — so locking there without a `begin` would release the lock
 * before `work` ever ran.
 */
function canBegin(sql: Sql): boolean {
  return typeof (sql as { begin?: unknown }).begin === 'function';
}

/**
 * Run `work` as the only writer of one `(org, domain)` config directory.
 *
 * Pass a transaction handle to join a caller's existing transaction — the
 * governance writers take this lock inside their audit transaction, so the
 * file write and the audit row commit together and the lock is held until
 * that outer transaction ends. Pass the root handle anywhere else and this
 * opens a transaction for the duration of `work`.
 *
 * The scaffolder passes `'org'`, which is deliberately a DIFFERENT key from
 * every per-domain one: it does not exclude them. Scaffolding is idempotent
 * per domain, and making `'org'` exclude everything would mean a slow reseed
 * blocks every org config save in the deployment.
 */
export async function withConfigWriteLock<T>(
  sql: Sql,
  orgSlug: string,
  domain: ConfigDomain,
  work: () => Promise<T>,
): Promise<T> {
  const key = configWriteLockKey(orgSlug, domain);
  if (!canBegin(sql)) {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return work();
  }
  // Assigned inside the callback: postgres.js types `begin`'s result through
  // an array-unwrapping conditional a generic `T` cannot collapse.
  let result!: T;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    result = await work();
  });
  return result;
}
