/** Context passed to every migration's detect/apply/requiredStops hook. */
export interface MigrationContext {
  projectId: string;
  projectDir: string;
}

/** Outcome of a single apply() call. */
export type ApplyOutcome = 'applied' | 'noop';

/**
 * A single migration step registered in the pipeline.
 *
 * Every migration must be **idempotent**, and its `detect` must be a pure
 * feature check against observable end-state:
 *
 *   - `detect` must return `true` only when the migration's postcondition
 *     does NOT already hold. Mere existence of source artifacts is not
 *     enough; the destination must also be absent/incomplete. Stray
 *     legacy volumes on the host from unrelated installs must never
 *     cause `detect` to return `true`.
 *   - `apply` must be safe to re-run at any point — on a fully satisfied
 *     system, on a partially-migrated system after an interruption, and
 *     on a freshly-initialised system. It must independently re-check
 *     each unit of work against the target state and skip units already
 *     satisfied.
 *   - `detect` and `apply` must NOT consult `migrations.json`, CLI
 *     versions, or any other external history. Those are caches/logs,
 *     not sources of truth — the filesystem/volume/container state is.
 *
 * A migration that can't express its precondition in terms of observable
 * end-state is a bug.
 */
export interface Migration {
  /** Stable id, used as the key in `.tale/migrations.json`. */
  id: string;
  /** CLI version that introduced this migration (for logs only). */
  introducedIn: string;
  /**
   * One-line human-readable description, shown in plan output. May be a
   * static string OR a function of the context when the description needs
   * to interpolate projectId etc. — plain strings never get template-literal
   * expansion at use site, so use the function form whenever the text
   * contains per-project names.
   */
  description: string | ((ctx: MigrationContext) => string);
  /** Returns true iff this migration has work to do given current state. */
  detect(ctx: MigrationContext): Promise<boolean>;
  /**
   * Docker compose project names / container names that must be stopped
   * before apply(). The runner collects the union across pending migrations
   * and stops them once.
   */
  requiredStops(ctx: MigrationContext): Promise<string[]>;
  /** Apply the migration. Must throw on any error. */
  apply(
    ctx: MigrationContext,
    opts: { dryRun: boolean },
  ): Promise<ApplyOutcome>;
}

/** Persisted record of a successfully-applied migration. */
export interface AppliedMigration {
  id: string;
  at: string;
  cliVersion: string;
}

/** Shape of `.tale/migrations.json`. */
export interface MigrationsState {
  applied: AppliedMigration[];
}
