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
 * Each migration must be idempotent: running `apply` twice must be safe.
 * Each migration's `detect` should inspect concrete state (volumes, files,
 * container layout) — never rely on CLI-version history — so version-skip
 * upgrades work correctly.
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
