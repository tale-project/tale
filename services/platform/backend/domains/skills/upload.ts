import type { Sql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import { MAX_SKILL_BUNDLE_TOTAL_BYTES } from '../../../lib/shared/schemas/skills.ts';
import { readOrgSkill, type OrgSkill } from '../../../lib/skills/listing.ts';
import { SkillParseError } from '../../../lib/skills/parse.ts';
import {
  canEditSkill,
  type UserSkillViewer,
} from '../../../lib/skills/visibility.ts';
import {
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import {
  s3DeleteObject,
  s3GetObjectBytes,
} from '../../core/lib/storage/object_store.ts';
import { parseSkillBundleZip } from '../../core/skills/bundle_zip.ts';
import { normalizedBundleFiles } from '../../core/skills/file_actions.ts';
import {
  createOrgSkillReader,
  listSkillBundleFileEntries,
  writeSkillBundleFiles,
} from '../../core/skills/file_utils.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { consumeUploadIntent } from '../files/upload-intents.ts';
import { withSkillWriterLock } from './writer-lock.ts';

/**
 * The skill bundle-upload lane on pg — the 0.4
 * `file_actions.uploadSkillBundle` re-orchestrated: the staged zip is an
 * ORG BLOB from the byte lane `POST /files/upload?purpose=skill_bundle`,
 * owned by the caller's single-use upload intent (`app.upload_intents`) —
 * the org-prefixed key alone proves tenancy, not ownership, because every
 * document blob in the org carries the same prefix and this lane DELETES
 * its staged blob on every path. The per-(org, slug) claim lock becomes a
 * pg advisory xact lock (`writer-lock.ts`, shared with the editor's save and
 * delete), and the parse/replace/write protocol (needs_confirm, force +
 * edit rights, owner adoption) is the reused helpers verbatim.
 */
type UploadOutcome =
  | { ok: true; slug: string }
  | { ok: false; status: 'needs_confirm'; slug: string };

export async function uploadSkillBundlePg(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    viewer: UserSkillViewer;
    storageId: string;
    force?: boolean;
  },
): Promise<UploadOutcome> {
  // Single-use: the intent is consumed here, and the blob dies with this
  // attempt (success or failure) — a `needs_confirm` round-trip re-uploads.
  const owned = await consumeUploadIntent(sql, {
    organizationId: args.organizationId,
    userId: args.viewer.userId,
    purpose: 'skill_bundle',
    storageRef: args.storageId,
  });
  let key: string | null = null;
  if (owned) {
    try {
      const parsedRef = parseBlobRef(args.storageId);
      if (parsedRef.backend === 's3') key = parsedRef.key;
    } catch {
      key = null;
    }
  }
  if (key === null || !s3KeyBelongsToOrg(key, args.orgSlug)) {
    throw new AppError({
      code: 'STORAGE_NOT_OWNED',
      message:
        'Upload session is missing or belongs to a different organization. Re-open the upload dialog and try again.',
    });
  }
  const stagedKey = key;
  const store = await resolveObjectStore(args.orgSlug);
  const cleanup = async (): Promise<void> => {
    try {
      await s3DeleteObject(store, stagedKey);
    } catch (error) {
      console.warn('[skills] staged bundle cleanup failed:', error);
    }
  };

  let bytes: Uint8Array;
  try {
    bytes = await s3GetObjectBytes(store, stagedKey);
  } catch {
    throw new AppError({
      code: 'STORAGE_NOT_FOUND',
      message: 'Uploaded bundle is missing from storage',
    });
  }
  if (bytes.byteLength > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
    await cleanup();
    throw new AppError({
      code: 'BUNDLE_TOO_LARGE',
      message: `Bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
    });
  }

  let parsed: Awaited<ReturnType<typeof parseSkillBundleZip>>;
  try {
    parsed = await parseSkillBundleZip(Buffer.from(bytes));
  } catch (err) {
    await cleanup();
    if (err instanceof AppError) throw err;
    throw new AppError({
      code: 'INVALID_BUNDLE',
      message:
        err instanceof Error ? err.message : 'Failed to read uploaded zip',
    });
  }

  // The replace decision — is there a bundle, may this member replace it,
  // whose skill does it stay — is taken INSIDE the per-(org, slug) writer
  // lock, exactly like the editor's save. Decided before it, two uploads of
  // one new slug both saw "no bundle": neither got needs_confirm and the
  // second silently overwrote the first, owner included. The lock is held
  // for a directory read and a rename, so a refusal holds it for nothing.
  let outcome: UploadOutcome;
  try {
    outcome = await withSkillWriterLock(
      sql,
      args.organizationId,
      parsed.slug,
      async () => {
        let existing: OrgSkill | null = null;
        let existingUnreadable = false;
        try {
          existing = await readOrgSkill(
            createOrgSkillReader(args.orgSlug),
            parsed.slug,
          );
        } catch (err) {
          if (!(err instanceof SkillParseError)) throw err;
          existingUnreadable = true;
        }
        const entries = await listSkillBundleFileEntries(
          args.orgSlug,
          parsed.slug,
        );
        const bundleExists =
          existing !== null || existingUnreadable || entries !== null;

        if (bundleExists && args.force !== true) {
          return { ok: false, status: 'needs_confirm', slug: parsed.slug };
        }
        if (bundleExists) {
          const allowed =
            existing !== null
              ? canEditSkill(existing.meta, args.viewer)
              : args.viewer.isOrgAdmin;
          if (!allowed) {
            throw new AppError({
              code: 'SKILL_FORBIDDEN',
              message: `You cannot replace the skill "${parsed.slug}".`,
            });
          }
        }

        // The owner and sharing rules the editor applies. An unreadable
        // existing document counts as no bundle: there is nothing left to
        // preserve.
        const files = normalizedBundleFiles(parsed, args.viewer, existing);
        try {
          await writeSkillBundleFiles(args.orgSlug, parsed.slug, files);
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw new AppError({
            code: 'WRITE_FAILED',
            message:
              err instanceof Error
                ? err.message
                : 'Failed to write skill bundle',
          });
        }
        return { ok: true, slug: parsed.slug };
      },
    );
  } finally {
    await cleanup();
  }

  return outcome;
}
