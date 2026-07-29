/**
 * THE central equality policy for migration data-integrity comparisons: what
 * the chain harness and the container e2e exempt when deep-comparing a world
 * digest before `up` against the digest after `down`.
 *
 * Every exemption is a reviewed, justified decision — adding one requires
 * editing this frozen literal, and the digest differ prints every applied
 * exemption in its failure output so the list can't silently grow.
 *
 * Two-dot `.testkit.ts` basename: test-only module, skipped by the Convex
 * bundler (same rule that excludes `migration.test.ts`).
 */

export const EQUALITY_EXEMPTIONS = Object.freeze({
  /** Tables excluded from digest comparison entirely — each asserted separately. */
  skipTables: Object.freeze({
    migrationLedger:
      'framework bookkeeping — direction/status/cursors are asserted explicitly per chain step, not diffed',
    migrationSnapshots:
      'consumed by downs — asserted EMPTY after a full rollback instead of diffed',
    configCache:
      'derived cache, not authoritative — asserted coherent against a fresh file sync post-up and post-down instead',
  }) as Readonly<Record<string, string>>,

  /**
   * Per-table fields stripped before hashing (beyond the always-stripped
   * `_id`/`_creationTime`, which table-rows restores mint fresh by design).
   * Key: table name; value: field names + the reason they may differ.
   */
  dropFields: Object.freeze({
    connectorCredentials: Object.freeze([
      // AES-256-GCM envelope minted by 0.4.0/23 with a random nonce: the same
      // plaintext re-encrypts to different bytes on every run, so two
      // independent `up`s can never agree byte-for-byte (chain C compares
      // exactly that). What the envelope CARRIES is asserted decrypted in the
      // migration's own test, and `down` restores the retired ciphertext
      // columns — which are compared like any other field.
      'encryptedData',
    ]),
  }) as Readonly<Record<string, readonly string[]>>,

  /** Config-dir path prefixes excluded from the fs digest. */
  skipFsPrefixes: Object.freeze({
    '.migration-snapshots/':
      'fs-tree sidecars persist after restore by design (restoreFsTree never deletes its source)',
  }) as Readonly<Record<string, string>>,
});

export function isTableExempt(table: string): boolean {
  return table in EQUALITY_EXEMPTIONS.skipTables;
}

export function isFsPathExempt(relPath: string): boolean {
  return Object.keys(EQUALITY_EXEMPTIONS.skipFsPrefixes).some((prefix) =>
    relPath.startsWith(prefix),
  );
}

/** One-line summary of every active exemption, for failure output. */
export function describeExemptions(): string[] {
  const out: string[] = [];
  for (const [table, why] of Object.entries(EQUALITY_EXEMPTIONS.skipTables)) {
    out.push(`table ${table} skipped: ${why}`);
  }
  for (const [table, fields] of Object.entries(
    EQUALITY_EXEMPTIONS.dropFields,
  )) {
    out.push(`table ${table} drops [${fields.join(', ')}]`);
  }
  for (const [prefix, why] of Object.entries(
    EQUALITY_EXEMPTIONS.skipFsPrefixes,
  )) {
    out.push(`fs prefix ${prefix} skipped: ${why}`);
  }
  return out;
}
