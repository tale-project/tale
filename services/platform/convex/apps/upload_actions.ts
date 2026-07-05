'use node';

/**
 * Upload a private APP bundle as a zip into the org's apps dir
 * (`<config>/<org>/apps/<slug>/`), so it appears in the Apps hub and can then be
 * installed through the normal lifecycle. Upload is NOT install — it only
 * materializes the bundle on disk; `installApp` (now org-dir-source-aware) does
 * the registration. Mirrors `skills/file_actions.ts:uploadSkillBundle`.
 *
 * Flow:
 *   1. Client uploads the zip to `_storage` via `generateAppUploadUrl`.
 *   2. Client calls this action with `{ organizationId, storageId, force? }`.
 *   3. Server verifies the upload intent, reads + parses the zip (slug from the
 *      single top-level folder, valid `app.json` manifest, size / zip-slip
 *      guards), and either:
 *        - refuses a slug that shadows a BUILTIN catalog app, OR
 *        - returns `{ ok: false, status: 'needs_confirm', slug }` when a private
 *          app of that slug already exists and `force !== true`, OR
 *        - stages the bundle to `<appDir>.staging-<uuid>/`, swaps it into place,
 *          and returns `{ ok: true, slug }`.
 *   4. Server deletes the staged blob + intent and releases the per-slug lock.
 *
 * Server-side validation is authoritative; the client parse is UX only.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import {
  isValidAppSlug,
  MAX_APP_BUNDLE_TOTAL_BYTES,
} from '../../lib/shared/schemas/apps';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, type ActionCtx } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  atomicWriteBuffer,
  readFileSafe,
  verifyPathWithinBase,
} from '../lib/file_io';
import { type ParsedAppBundle, parseAppBundleZip } from './bundle_parse';
import {
  resolveAppDir,
  resolveAppManifestPath,
  resolveAppsDir,
} from './file_utils';
import { appExistsInBuiltinCatalog } from './install_fs';

/**
 * Tear down both the staged `_storage` blob and its `appUploadIntents` row so
 * every exit path leaves no orphan resources. Failures here only log — the
 * user-visible operation has already succeeded or failed independently.
 */
async function cleanupUploadResources(
  ctx: ActionCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  await ctx.storage.delete(storageId).catch((err) => {
    console.warn('[uploadAppBundle] storage.delete failed:', err);
  });
  await ctx
    .runMutation(internal.apps.upload_mutations.deleteAppUploadIntent, {
      storageId,
    })
    .catch((err) => {
      console.warn('[uploadAppBundle] deleteAppUploadIntent failed:', err);
    });
}

export const uploadAppBundle = action({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      slug: v.string(),
    }),
    v.object({
      ok: v.literal(false),
      status: v.literal('needs_confirm'),
      slug: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Ownership gate: refuse before reading the blob if the storageId isn't
    // bound to this org via `recordAppUploadIntent`. Without this an
    // authenticated caller could point the server at any other org's pending
    // storageId. The intent row is deleted in the `finally` paths below.
    const intentMatch = await ctx.runMutation(
      internal.apps.upload_mutations.verifyAppUploadIntent,
      { organizationId: args.organizationId, storageId: args.storageId },
    );
    if (!intentMatch) {
      throw new ConvexError({
        code: 'STORAGE_NOT_OWNED',
        message:
          'Upload session is missing or belongs to a different organization. Re-open the upload dialog and try again.',
      });
    }

    const blob = await ctx.storage.get(args.storageId);
    if (!blob) {
      await ctx.runMutation(
        internal.apps.upload_mutations.deleteAppUploadIntent,
        { storageId: args.storageId },
      );
      throw new ConvexError({
        code: 'STORAGE_NOT_FOUND',
        message: 'Uploaded bundle is missing from storage',
      });
    }
    if (blob.size > MAX_APP_BUNDLE_TOTAL_BYTES) {
      await cleanupUploadResources(ctx, args.storageId);
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle exceeds ${MAX_APP_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }

    let parsed: ParsedAppBundle;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      parsed = await parseAppBundleZip(bytes);
    } catch (err) {
      await cleanupUploadResources(ctx, args.storageId);
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message:
          err instanceof Error ? err.message : 'Failed to read uploaded zip',
      });
    }

    // A first-party builtin app is authoritative — a private upload of the same
    // slug would shadow it in the org dir (where install/list resolve from).
    // Refuse so the catalog stays unambiguous.
    if (await appExistsInBuiltinCatalog(parsed.slug)) {
      await cleanupUploadResources(ctx, args.storageId);
      throw new ConvexError({
        code: 'APP_SLUG_RESERVED',
        message: `"${parsed.slug}" is a built-in app — choose a different folder name for your private app.`,
      });
    }

    const appDir = resolveAppDir(auth.orgSlug, parsed.slug);
    const appsRoot = resolveAppsDir(auth.orgSlug);
    const existing = await readFileSafe(
      resolveAppManifestPath(auth.orgSlug, parsed.slug),
    );

    if (existing !== null && !args.force) {
      // Caller hasn't confirmed replace; clean up the staged blob + intent so
      // we don't leak storage. Client re-uploads with force:true.
      await cleanupUploadResources(ctx, args.storageId);
      return {
        ok: false as const,
        status: 'needs_confirm' as const,
        slug: parsed.slug,
      };
    }

    // Per-(orgId, slug) exclusion lock. Acquired AFTER parse + existence check
    // (so we don't block on unparseable bundles) and BEFORE the rename-swap.
    // Released in `finally`.
    await ctx.runMutation(internal.apps.upload_mutations.claimAppUploadSlot, {
      organizationId: args.organizationId,
      slug: parsed.slug,
    });

    const stagingDir = `${appDir}.staging-${randomUUID().slice(0, 8)}`;
    const replacingDir = `${appDir}.replacing-${randomUUID().slice(0, 8)}`;
    await mkdir(appsRoot, { recursive: true });

    try {
      for (const file of parsed.files) {
        const dest = path.join(stagingDir, file.relPath);
        await verifyPathWithinBase(dest, stagingDir);
        await atomicWriteBuffer(dest, Buffer.from(file.content));
      }

      // Atomic swap. Once `appDir → replacingDir` succeeds, the old bundle is
      // preserved; the next rename is the commit point.
      const hadExisting = existing !== null;
      if (hadExisting) {
        await rename(appDir, replacingDir);
      }
      try {
        await rename(stagingDir, appDir);
      } catch (err) {
        if (hadExisting) {
          await rename(replacingDir, appDir).catch((rollbackErr) => {
            console.error(
              '[uploadAppBundle] failed to roll back previous bundle:',
              rollbackErr,
            );
          });
        }
        throw err;
      }
      if (hadExisting) {
        await rm(replacingDir, { recursive: true, force: true }).catch(
          (err) => {
            console.warn(
              '[uploadAppBundle] failed to remove replaced bundle dir; leaving for manual cleanup:',
              err,
            );
          },
        );
      }
    } catch (err) {
      await rm(stagingDir, { recursive: true, force: true }).catch(
        (cleanupErr) => {
          console.warn('[uploadAppBundle] staging cleanup failed:', cleanupErr);
        },
      );
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'WRITE_FAILED',
        message:
          err instanceof Error ? err.message : 'Failed to write app bundle',
      });
    } finally {
      await cleanupUploadResources(ctx, args.storageId);
      await ctx
        .runMutation(internal.apps.upload_mutations.releaseAppUploadSlot, {
          organizationId: args.organizationId,
          slug: parsed.slug,
        })
        .catch((err) => {
          console.warn('[uploadAppBundle] release slot failed:', err);
        });
    }

    return { ok: true as const, slug: parsed.slug };
  },
});

/**
 * Delete a PRIVATE (uploaded) app's on-disk bundle — the inverse of
 * `uploadAppBundle`. Removes `<config>/<org>/apps/<slug>/` so the app leaves the
 * Apps hub for good. Two guards keep it safe:
 *
 *   1. A first-party BUILT-IN app can never be deleted here — the catalog is
 *      read-only, and its dir doesn't even live under the org (this is a no-op
 *      on disk, but we refuse loudly so the UI never offers it).
 *   2. An app with an active install record is refused (`APP_INSTALLED`): deleting
 *      the bundle out from under a live install would orphan its agent/workflow
 *      rows, schedules, and env/secrets. Uninstall first (which, for a private
 *      app, keeps the bundle on disk), then delete.
 *
 * Idempotent: a slug with no bundle on disk returns `{ deleted: false }`.
 */
export const deleteApp = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!isValidAppSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid app slug: ${args.slug}`,
      });
    }
    // Same gate as upload (developer-settings capability): whoever can upload a
    // private app can remove it.
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    if (await appExistsInBuiltinCatalog(args.slug)) {
      throw new ConvexError({
        code: 'APP_IS_BUILTIN',
        message: `"${args.slug}" is a built-in app and cannot be deleted.`,
      });
    }

    const record = await ctx.runQuery(
      internal.apps.install_mutations.getAppInstallationInternal,
      { organizationId: args.organizationId, appSlug: args.slug },
    );
    if (record) {
      throw new ConvexError({
        code: 'APP_INSTALLED',
        message: `Uninstall "${args.slug}" before deleting its upload.`,
      });
    }

    // No manifest on disk → nothing to delete (the app was never uploaded here,
    // or was already removed). Report a no-op rather than a spurious success.
    const manifest = await readFileSafe(
      resolveAppManifestPath(auth.orgSlug, args.slug),
    );
    if (manifest === null) return { deleted: false };

    await rm(resolveAppDir(auth.orgSlug, args.slug), {
      recursive: true,
      force: true,
    });
    return { deleted: true };
  },
});
