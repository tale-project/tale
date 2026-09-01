import type { Sql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import { MAX_SKILL_BUNDLE_TOTAL_BYTES } from '../../../lib/shared/schemas/skills.ts';
import { readOrgSkill } from '../../../lib/skills/listing.ts';
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

/**
 * The skill bundle-upload lane on pg — the 0.4
 * `file_actions.uploadSkillBundle` re-orchestrated: the staged zip is an
 * ORG BLOB from the byte-lane `POST /files/upload` (ownership IS the
 * org-prefixed key; the 0.4 intent row dies), the per-(org, slug) claim
 * lock becomes a pg advisory xact lock, and the parse/replace/write
 * protocol (needs_confirm, force + edit rights, owner adoption) is the
 * reused helpers verbatim.
 */
export async function uploadSkillBundlePg(
  sql: Sql,
  args: {
    organizationId: string;
    orgSlug: string;
    viewer: UserSkillViewer;
    storageId: string;
    force?: boolean;
  },
): Promise<
  | { ok: true; slug: string }
  | { ok: false; status: 'needs_confirm'; slug: string }
> {
  let key: string | null = null;
  try {
    const parsedRef = parseBlobRef(args.storageId);
    if (parsedRef.backend === 's3') key = parsedRef.key;
  } catch {
    key = null;
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

  let existing = null;
  let existingUnreadable = false;
  try {
    existing = await readOrgSkill(
      createOrgSkillReader(args.orgSlug),
      parsed.slug,
    );
  } catch (err) {
    if (err instanceof SkillParseError) {
      existingUnreadable = true;
    } else {
      await cleanup();
      throw err;
    }
  }
  const entries = await listSkillBundleFileEntries(args.orgSlug, parsed.slug);
  const bundleExists =
    existing !== null || existingUnreadable || entries !== null;

  if (bundleExists && args.force !== true) {
    await cleanup();
    return { ok: false, status: 'needs_confirm', slug: parsed.slug };
  }
  if (bundleExists) {
    const allowed =
      existing !== null
        ? canEditSkill(existing.meta, args.viewer)
        : args.viewer.isOrgAdmin;
    if (!allowed) {
      await cleanup();
      throw new AppError({
        code: 'SKILL_FORBIDDEN',
        message: `You cannot replace the skill "${parsed.slug}".`,
      });
    }
  }

  // Per-(org, slug) writer mutex — the 0.4 claim-slot table collapses into
  // one advisory xact lock (rule 5).
  try {
    await sql.begin(async (tx) => {
      await tx`
        SELECT pg_advisory_xact_lock(
          hashtext(${`skill:${args.organizationId}:${parsed.slug}`})
        )
      `;
      await writeSkillBundleFiles(
        args.orgSlug,
        parsed.slug,
        normalizedBundleFiles(parsed, args.viewer),
      );
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError({
      code: 'WRITE_FAILED',
      message:
        err instanceof Error ? err.message : 'Failed to write skill bundle',
    });
  } finally {
    await cleanup();
  }

  return { ok: true, slug: parsed.slug };
}
