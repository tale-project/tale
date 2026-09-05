import { lstat } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { purgeCorpusForOrg } from '../../core/knowledge/teardown.ts';
import { errnoCode } from '../../core/lib/file_io.ts';
import { s3KeyBelongsToOrg } from '../../core/lib/storage/blob_ref.ts';
import {
  invalidateOrgObjectStore,
  ObjectStoreUnconfiguredError,
  orgObjectPrefix,
  resolveOrgObjectStore,
  s3DeleteObject,
  s3ListObjectKeys,
} from '../../core/lib/storage/object_store.ts';
import { removeOrgSubtree } from '../../core/organizations/scaffold.ts';

/**
 * The second half of organization deletion — the `org.cleanup_files` job.
 *
 * `deleteOrganization` removes every row keyed by the organization's id in
 * one transaction. What the SLUG keys lives outside that database and cannot
 * ride the transaction: the knowledge corpus (`org_slug`), the object-store
 * blobs (`<prefix>/<slug>/…`) and the config tree (`$TALE_CONFIG_DIR/<slug>`).
 * This job removes them, in an order that keeps every retry safe:
 *
 *   1. corpus — resolved through the org's knowledge connection config, so
 *      it must go while the config tree still exists;
 *   2. blobs — resolved through the org's object-storage config, same reason;
 *   3. config tree — fail-closed: `removeOrgSubtree` refuses rather than
 *      throws (a symlinked dir, a rename that failed), so the job itself
 *      checks that `<root>/<slug>` is gone before it goes on;
 *   4. the slug tombstone — LAST, because the tombstone is what keeps a new
 *      organization from taking the slug while any of the above remains.
 *
 * Every step is idempotent and the tombstone survives any failure, so a
 * retry (pg-boss, or the re-enqueue a refused slug claim triggers) resumes
 * where the previous attempt stopped. A slug a LIVE organization owns is
 * never touched (a stale job from an older release).
 */
export interface TeardownResult {
  status: 'refused' | 'done';
  corpusDocuments: number;
  blobs: number;
}

export async function teardownDeletedOrganization(
  sql: Sql,
  orgSlug: string,
): Promise<TeardownResult> {
  const configRoot = process.env.TALE_CONFIG_DIR;
  if (!configRoot) {
    throw new Error(
      'TALE_CONFIG_DIR is unset — cannot clean up the org config subtree',
    );
  }
  const owners = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" WHERE "slug" = ${orgSlug} LIMIT 1
  `;
  if (owners.length > 0) {
    console.error(
      `[org.cleanup_files] refusing: organization ${owners[0]?.id} still owns slug "${orgSlug}"`,
    );
    return { status: 'refused', corpusDocuments: 0, blobs: 0 };
  }

  const corpus = await purgeCorpusForOrg(orgSlug);
  const blobs = await deleteOrgBlobs(orgSlug);
  // Guarded two-phase rename-then-delete (slug validation, traversal +
  // symlink defenses) — reused from the 0.4 module unchanged.
  await removeOrgSubtree(configRoot, orgSlug);
  await assertOrgTreeGone(configRoot, orgSlug);
  invalidateOrgObjectStore(orgSlug);

  await sql`DELETE FROM app.organization_tombstones WHERE slug = ${orgSlug}`;
  return { status: 'done', corpusDocuments: corpus.documents, blobs };
}

/**
 * `removeOrgSubtree` is non-fatal by contract — every refusal (symlinked org
 * dir, traversal guard, failed rename) logs and returns, because its other
 * caller, the scaffolder, must proceed to seed regardless. Here a tree left
 * standing means the slug still keys files, so the job must fail and keep the
 * tombstone: only ENOENT on `<root>/<slug>` lets the teardown finish.
 */
async function assertOrgTreeGone(
  configRoot: string,
  orgSlug: string,
): Promise<void> {
  const orgDir = path.join(configRoot, orgSlug);
  try {
    await lstat(orgDir);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    throw error;
  }
  throw new Error(
    `[org.cleanup_files] config tree "${orgDir}" still exists after removal — keeping the slug tombstone for a retry`,
  );
}

/**
 * Delete every blob under the org's key prefix in the org's resolved store.
 * No store at all (neither the org nor the default tree configured one)
 * means no blobs were ever written — not a failure. Only keys whose org
 * segment is this slug are deleted, the same rule every blob read enforces.
 */
async function deleteOrgBlobs(orgSlug: string): Promise<number> {
  let store;
  try {
    store = await resolveOrgObjectStore(orgSlug);
  } catch (error) {
    if (error instanceof ObjectStoreUnconfiguredError) {
      console.warn(
        `[org.cleanup_files] no object store configured for "${orgSlug}" — no blobs to remove`,
      );
      return 0;
    }
    throw error;
  }
  const keys = await s3ListObjectKeys(store, orgObjectPrefix(store, orgSlug));
  let deleted = 0;
  for (const key of keys) {
    if (!s3KeyBelongsToOrg(key, orgSlug)) {
      console.warn(
        `[org.cleanup_files] leaving "${key}": not in the org's key namespace`,
      );
      continue;
    }
    await s3DeleteObject(store, key);
    deleted += 1;
  }
  return deleted;
}
