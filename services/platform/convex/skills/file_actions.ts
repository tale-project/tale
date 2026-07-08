'use node';

/**
 * Skill file I/O actions (Convex action surface for the `/skills` page and
 * for the runtime engine's snapshot read).
 *
 * Storage model mirrors agents/integrations: SKILL.md + bundle assets on
 * disk under `${TALE_CONFIG_DIR}/<orgSlug>/skills/<slug>/`. There is NO Convex
 * DB table for skills — the file is the source of truth, team scoping and
 * role restriction live in YAML frontmatter, author/timestamps come from
 * audit_logs (see Phase 5c follow-up).
 *
 * All write paths enforce: CAS via `expectedHash`, symlink rejection
 * (via `O_NOFOLLOW` in `readSkillMd`), and traversal guards
 * (`validateAssetRelPath` inside the path resolver). The
 * `readSkillForExecution` internal action reads the full bundle into
 * memory and is the only entrypoint the runtime engine uses — it returns
 * the SKILL.md content hash so the runtime snapshot can detect drift.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';
import JSZip from 'jszip';

import {
  parseSkillMd,
  type SkillFrontmatter,
} from '../../lib/shared/schemas/skills';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { internalAction, action, type ActionCtx } from '../_generated/server';
import { invalidateSkillContextCache } from '../lib/agent_chat/skill_context_cache';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { type OrgMembershipAuth } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  atomicWriteBuffer,
  readFileBufferSafe,
  readFileSafe,
  readdirSafe,
  sha256,
  verifyPathWithinBase,
} from '../lib/file_io';
import {
  MAX_SKILL_BUNDLE_ENTRIES,
  MAX_SKILL_BUNDLE_FILE_BYTES,
  MAX_SKILL_BUNDLE_TOTAL_BYTES,
  readSkillMd,
  resolveCatalogSkillDir,
  resolveCatalogSkillsDir,
  resolveSkillAssetPathChecked,
  resolveSkillDir,
  resolveSkillMdPath,
  resolveSkillsDir,
  serializeSkillMd,
  validateSkillSlug,
} from './file_utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SkillAuditAction =
  | 'upload_skill'
  | 'create_skill'
  | 'duplicate_skill'
  | 'update_skill'
  | 'delete_skill';

async function logSkillAudit(
  ctx: ActionCtx,
  auth: OrgMembershipAuth,
  auditAction: SkillAuditAction,
  slug: string,
  states: {
    resourceName?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await ctx.runMutation(internal.skills.audit_mutations.logSkillAuditEvent, {
      organizationId: auth.orgId,
      actorId: auth.userId,
      ...(auth.email ? { actorEmail: auth.email } : {}),
      actorRole: auth.member.role,
      action: auditAction,
      resourceId: slug,
      ...(states.resourceName !== undefined && {
        resourceName: states.resourceName,
      }),
      ...(states.previousState !== undefined && {
        previousState: states.previousState,
      }),
      ...(states.newState !== undefined && { newState: states.newState }),
    });
  } catch (err) {
    // Audit logging must never block the user-visible operation. Log and
    // continue — observability is on the SRE side via dashboard alerts on
    // the audit_logs write rate.
    console.warn('[skills.audit] logSkillAuditEvent failed:', err);
  }
}

/**
 * Tear down both the staged `_storage` blob and its `skillUploadIntents`
 * row in one place so every exit path of `uploadSkillBundle` (early
 * reject, needs_confirm, parse failure, write failure, success-finally)
 * leaves no orphan resources. Failures here only log — the user-visible
 * operation has already succeeded or failed independently.
 */
async function cleanupUploadResources(
  ctx: ActionCtx,
  storageId: Id<'_storage'>,
): Promise<void> {
  await ctx.storage.delete(storageId).catch((err) => {
    console.warn('[uploadSkillBundle] storage.delete failed:', err);
  });
  await ctx
    .runMutation(internal.skills.upload_mutations.deleteSkillUploadIntent, {
      storageId,
    })
    .catch((err) => {
      console.warn('[uploadSkillBundle] deleteSkillUploadIntent failed:', err);
    });
}

interface AssetEntry {
  path: string;
  size: number;
}

/**
 * Walk a skill bundle directory, returning every regular file relative to
 * the skill root, excluding `SKILL.md`. Skips symlinks (defense-in-depth)
 * and dotfiles. Used by the listing UI and the runtime bundle loader.
 */
async function walkSkillBundle(
  skillDir: string,
): Promise<{ assets: AssetEntry[]; totalBytes: number }> {
  const assets: AssetEntry[] = [];
  let totalBytes = 0;

  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(
      (err) => {
        // Log non-ENOENT (EACCES / EIO) so a permissions glitch in one
        // subdir doesn't silently shrink the asset list. Treat as empty
        // for ENOENT (caller may be enumerating a not-yet-created dir).
        if (
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          console.warn('[walkSkillBundle] readdir failed:', currentDir, err);
        }
        return [] as never[];
      },
    );
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relPrefix === '' ? e.name : `${relPrefix}/${e.name}`;
      const abs = path.join(currentDir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      if (rel === 'SKILL.md') continue;
      const st = await stat(abs).catch((err) => {
        if (
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code !== 'ENOENT'
        ) {
          console.warn('[walkSkillBundle] stat failed:', abs, err);
        }
        return null;
      });
      if (!st) continue;
      assets.push({ path: rel, size: st.size });
      totalBytes += st.size;
    }
  }

  await walk(skillDir, '');
  assets.sort((a, b) => a.path.localeCompare(b.path));
  return { assets, totalBytes };
}

interface ParsedBundleFile {
  /** Path relative to the bundle root (no leading slash, POSIX separators). */
  relPath: string;
  content: Buffer;
}

interface ParsedBundle {
  slug: string;
  meta: SkillFrontmatter;
  /** Includes SKILL.md as the first entry. */
  files: ParsedBundleFile[];
  /** sha256 of the SKILL.md content as written. */
  skillMdHash: string;
  /** Total bytes of the bundle (SKILL.md + all assets). */
  totalBytes: number;
}

/**
 * Decode an uploaded zip into the in-memory shape we'll write to disk.
 * Re-validates every constraint the client checked: SKILL.md must exist,
 * frontmatter must parse, slug must validate, no zip-slip paths, per-file
 * and total caps. The client validation is for UX only — this is the
 * authoritative check.
 *
 * Accepts the common "one wrapper folder" shape that browsers produce when
 * a user zips a directory: if every entry shares a single top-level folder,
 * that folder is stripped before further processing.
 */
async function parseSkillBundleZip(buf: Buffer): Promise<ParsedBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (err) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Not a valid zip archive: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Drop OS-injected junk before any other processing. macOS Finder's
  // "Compress" produces a sibling `__MACOSX/` tree alongside the user's
  // folder; if it survives to `detectSingleTopLevelFolder` it defeats the
  // wrapper-strip and the user's `myskill/SKILL.md` looks nested → bundle
  // fails with a misleading "missing SKILL.md" error. `__MACOSX` starts
  // with `_` not `.`, so the per-segment dotfile filter doesn't catch it.
  const rawEntries = Object.entries(zip.files).filter(
    ([name]) => !isOsMetadataEntry(name),
  );
  if (rawEntries.length === 0) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: 'Zip is empty',
    });
  }
  if (rawEntries.length > MAX_SKILL_BUNDLE_ENTRIES) {
    throw new ConvexError({
      code: 'INVALID_BUNDLE',
      message: `Bundle contains ${rawEntries.length} entries (max ${MAX_SKILL_BUNDLE_ENTRIES})`,
    });
  }

  const stripPrefix = detectSingleTopLevelFolder(rawEntries);

  let skillMdEntry: JSZip.JSZipObject | undefined;
  const assetEntries: { relPath: string; entry: JSZip.JSZipObject }[] = [];

  for (const [name, entry] of rawEntries) {
    if (entry.dir) continue;
    const rel = stripPrefix ? name.slice(stripPrefix.length) : name;
    if (rel === '') continue;
    if (rel.includes('\0')) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry path contains NUL byte`,
      });
    }
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message: `Bundle entry uses absolute path: ${rel}`,
      });
    }
    const segments = rel.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '..' || seg === '.') {
        throw new ConvexError({
          code: 'INVALID_BUNDLE',
          message: `Bundle entry path is unsafe: ${rel}`,
        });
      }
    }
    if (rel === 'SKILL.md') {
      skillMdEntry = entry;
      continue;
    }
    // Skip dotfiles silently (matches walkSkillBundle's listing behavior).
    if (segments.some((s) => s.startsWith('.'))) continue;
    assetEntries.push({ relPath: rel, entry });
  }

  if (!skillMdEntry) {
    throw new ConvexError({
      code: 'MISSING_SKILL_MD',
      message: 'Bundle is missing SKILL.md at the root',
    });
  }

  const skillMdContent = await skillMdEntry.async('string');
  let meta;
  try {
    ({ meta } = parseSkillMd(skillMdContent));
  } catch (err) {
    throw new ConvexError({
      code: 'INVALID_SKILL_MD',
      message: `SKILL.md frontmatter rejected: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const slug = meta.name;
  if (!validateSkillSlug(slug)) {
    throw new ConvexError({
      code: 'INVALID_SLUG',
      message: `Frontmatter name "${slug}" is not a valid skill slug`,
    });
  }

  const files: ParsedBundleFile[] = [];
  let totalBytes = 0;
  const skillMdBuf = Buffer.from(skillMdContent, 'utf-8');
  if (skillMdBuf.length > MAX_SKILL_BUNDLE_FILE_BYTES) {
    throw new ConvexError({
      code: 'FILE_TOO_LARGE',
      message: `SKILL.md exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
    });
  }
  totalBytes += skillMdBuf.length;
  files.push({ relPath: 'SKILL.md', content: skillMdBuf });

  for (const { relPath, entry } of assetEntries) {
    const assetBuf = Buffer.from(await entry.async('uint8array'));
    if (assetBuf.length > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw new ConvexError({
        code: 'FILE_TOO_LARGE',
        message: `Asset "${relPath}" exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
      });
    }
    totalBytes += assetBuf.length;
    if (totalBytes > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Decompressed bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }
    files.push({ relPath, content: assetBuf });
  }

  return {
    slug,
    meta,
    files,
    skillMdHash: sha256(skillMdContent),
    totalBytes,
  };
}

/**
 * Drop OS-injected metadata entries that would otherwise pollute the
 * bundle. Mirrored on the client in `parse-skill-bundle.ts`.
 */
function isOsMetadataEntry(name: string): boolean {
  if (name.startsWith('__MACOSX/') || name === '__MACOSX') return true;
  const basename = name.split('/').pop() ?? '';
  return basename === '.DS_Store' || basename === 'Thumbs.db';
}

function detectSingleTopLevelFolder(
  entries: [string, JSZip.JSZipObject][],
): string | null {
  let prefix: string | null = null;
  for (const [name] of entries) {
    if (name === '') continue;
    const slash = name.indexOf('/');
    if (slash === -1) return null; // a root-level file disqualifies stripping
    const top = name.slice(0, slash + 1);
    if (prefix === null) {
      prefix = top;
    } else if (prefix !== top) {
      return null;
    }
  }
  return prefix;
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const result = await readSkillMd(orgSlug, args.slug);
    if (!result.ok) return result;
    const skillDir = resolveSkillDir(orgSlug, args.slug);
    const { assets, totalBytes } = await walkSkillBundle(skillDir);
    return {
      ok: true as const,
      slug: args.slug,
      meta: result.meta,
      body: result.body,
      hash: result.versionHash,
      assets,
      totalBytes,
    };
  },
});

/**
 * Convex validator for one row of `listSkills` output. Rows are either a
 * success entry (SKILL.md parsed cleanly) or an error entry (one of the
 * `SkillReadResult.error` codes) — never anything else. Kept in sync
 * with the handler below.
 */
const listSkillsRowValidator = v.union(
  v.object({
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    recommendedPackages: v.optional(
      v.object({
        python: v.optional(v.array(v.string())),
        node: v.optional(v.array(v.string())),
      }),
    ),
    license: v.optional(v.string()),
    icon: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    hash: v.string(),
  }),
  v.object({
    slug: v.string(),
    status: v.union(
      v.literal('not_found'),
      v.literal('corrupted'),
      v.literal('symlink'),
      v.literal('inaccessible'),
    ),
    message: v.string(),
  }),
);

/**
 * One entry surfaced by `listSkills`. Shared with the frontend so
 * consumers (SkillsTable, SkillSelector, agent Skills tab) get the same
 * union as the Convex validator and don't need defensive narrowing.
 */
export type SkillListEntry =
  | {
      slug: string;
      name: string;
      description: string;
      recommendedPackages?: { python?: string[]; node?: string[] };
      license?: string;
      icon?: string;
      labels?: string[];
      hash: string;
    }
  | {
      slug: string;
      status: 'not_found' | 'corrupted' | 'symlink' | 'inaccessible';
      message: string;
    };

/**
 * The catalog twin's `icon:` for an org skill whose own SKILL.md predates the
 * icon frontmatter (a bundle seeded before icons shipped keeps rendering the
 * generic fallback otherwise — every skill "same icon"). Best-effort: any
 * miss (no catalog twin, unparseable) yields undefined.
 */
async function readCatalogSkillIcon(slug: string): Promise<string | undefined> {
  const content = await readFileSafe(
    path.join(resolveCatalogSkillsDir(), slug, 'SKILL.md'),
  );
  if (content === null) return undefined;
  try {
    return parseSkillMd(content).meta.icon;
  } catch {
    return undefined;
  }
}

export const listSkills = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(listSkillsRowValidator),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const dir = resolveSkillsDir(orgSlug);
    const entries = await readdirSafe(dir);
    const slugs = entries.filter(
      (e) => !e.startsWith('.') && validateSkillSlug(e),
    );

    const results = await Promise.all(
      slugs.map(async (slug) => {
        const result = await readSkillMd(orgSlug, slug);
        if (!result.ok) {
          return {
            slug,
            status: result.error,
            message: result.message,
          };
        }
        const icon = result.meta.icon ?? (await readCatalogSkillIcon(slug));
        return {
          slug,
          name: result.meta.name,
          description: result.meta.description,
          recommendedPackages: result.meta.recommendedPackages,
          license: result.meta.license,
          icon,
          labels: result.meta.labels,
          hash: result.versionHash,
        };
      }),
    );
    return results;
  },
});

export const readSkillAsset = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    assetPath: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const filePath = await resolveSkillAssetPathChecked(
      orgSlug,
      args.slug,
      args.assetPath,
    );
    const content = await readFileSafe(filePath);
    if (content === null) {
      return { ok: false as const, error: 'not_found' as const };
    }
    return {
      ok: true as const,
      content,
    };
  },
});

/**
 * Upload an entire skill bundle as a zip. The bundle is the single write
 * surface for skills — there is no in-place SKILL.md editor or asset
 * editor. A successful upload replaces any existing bundle for the same
 * slug atomically.
 *
 * Flow:
 *   1. Client uploads the zip to `_storage` via `generateUploadUrl`.
 *   2. Client calls this action with `{ organizationId, storageId, force? }`.
 *   3. Server reads + parses the zip, validates structure / SKILL.md /
 *      sizes / zip-slip, and either:
 *        - returns `{ ok: false, status: 'needs_confirm', slug }` when the
 *          slug already exists and `force !== true` (no disk mutation), OR
 *        - stages the bundle to `<skillDir>.staging-<uuid>/`, swaps it into
 *          place (rename old → `.replacing-<uuid>`, rename staging → final,
 *          rm replaced), and returns `{ ok: true, slug, hash }`.
 *   4. Server deletes the staged `_storage` blob.
 *
 * All validation re-runs on the server even though the client has its own
 * parse step — the client validation is for UX only; the server is
 * authoritative.
 */
export const uploadSkillBundle = action({
  args: {
    organizationId: v.string(),
    storageId: v.id('_storage'),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      ok: v.literal(true),
      slug: v.string(),
      hash: v.string(),
    }),
    v.object({
      ok: v.literal(false),
      status: v.literal('needs_confirm'),
      slug: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Ownership gate: refuse before reading the blob if the storageId
    // isn't bound to this org via `recordSkillUploadIntent`. Without this
    // an authenticated caller could point the server at any other org's
    // pending storageId. The intent row is deleted in `finally` along with
    // the blob.
    const intentMatch = await ctx.runMutation(
      internal.skills.upload_mutations.verifySkillUploadIntent,
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
        internal.skills.upload_mutations.deleteSkillUploadIntent,
        { storageId: args.storageId },
      );
      throw new ConvexError({
        code: 'STORAGE_NOT_FOUND',
        message: 'Uploaded bundle is missing from storage',
      });
    }
    if (blob.size > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      await cleanupUploadResources(ctx, args.storageId);
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }

    let parsed: ParsedBundle;
    try {
      const buf = Buffer.from(await blob.arrayBuffer());
      parsed = await parseSkillBundleZip(buf);
    } catch (err) {
      await cleanupUploadResources(ctx, args.storageId);
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'INVALID_BUNDLE',
        message:
          err instanceof Error ? err.message : 'Failed to read uploaded zip',
      });
    }

    const bundleDir = resolveSkillDir(auth.orgSlug, parsed.slug);
    const skillsRoot = resolveSkillsDir(auth.orgSlug);
    const existing = await readFileSafe(
      resolveSkillMdPath(auth.orgSlug, parsed.slug),
    );

    if (existing !== null && !args.force) {
      // Caller hasn't confirmed replace; clean up the staged blob + intent
      // so we don't leak storage. Client re-uploads with force:true,
      // generating a fresh storageId and intent.
      await cleanupUploadResources(ctx, args.storageId);
      return {
        ok: false as const,
        status: 'needs_confirm' as const,
        slug: parsed.slug,
      };
    }

    let previousCapability: Record<string, unknown> | undefined;
    if (existing !== null) {
      try {
        const prev = parseSkillMd(existing);
        previousCapability = {
          description: prev.meta.description,
          ...(prev.meta.recommendedPackages && {
            recommendedPackages: prev.meta.recommendedPackages,
          }),
        };
      } catch (err) {
        console.warn(
          `[skills.uploadSkillBundle] parseSkillMd failed on previous SKILL.md for slug=${parsed.slug}:`,
          err,
        );
      }
    }

    // Per-(orgId, slug) exclusion lock. Acquired AFTER parse + existence
    // check (so we don't block on unparseable bundles) and BEFORE the
    // rename-swap pair. Released in `finally`. A second concurrent upload
    // to the same slug sees `LOCK_HELD` and fails fast.
    await ctx.runMutation(
      internal.skills.upload_mutations.claimSkillUploadSlot,
      { organizationId: args.organizationId, slug: parsed.slug },
    );

    const stagingDir = `${bundleDir}.staging-${randomUUID().slice(0, 8)}`;
    const replacingDir = `${bundleDir}.replacing-${randomUUID().slice(0, 8)}`;
    await mkdir(skillsRoot, { recursive: true });

    try {
      // Write the new bundle to the staging dir.
      for (const file of parsed.files) {
        const dest = path.join(stagingDir, file.relPath);
        await verifyPathWithinBase(dest, stagingDir);
        await atomicWriteBuffer(dest, file.content);
      }

      // Atomic swap. Once `bundleDir → replacingDir` succeeds, the old
      // bundle is preserved; the next rename is the commit point.
      const hadExisting = existing !== null;
      if (hadExisting) {
        await rename(bundleDir, replacingDir);
      }
      try {
        await rename(stagingDir, bundleDir);
      } catch (err) {
        // Roll back the rename of the previous bundle so the user still
        // has the old content. Best-effort: log and rethrow.
        if (hadExisting) {
          await rename(replacingDir, bundleDir).catch((rollbackErr) => {
            console.error(
              '[uploadSkillBundle] failed to roll back previous bundle:',
              rollbackErr,
            );
          });
        }
        throw err;
      }
      if (hadExisting) {
        await rm(replacingDir, { recursive: true, force: true }).catch(
          (err) => {
            // Data is safe at this point; orphaned `.replacing-*` is a leak
            // for ops to clean up, not a correctness issue.
            console.warn(
              '[uploadSkillBundle] failed to remove replaced bundle dir; leaving for manual cleanup:',
              err,
            );
          },
        );
      }
    } catch (err) {
      // Pre-commit failure path: clean up staging, surface error.
      await rm(stagingDir, { recursive: true, force: true }).catch(
        (cleanupErr) => {
          console.warn(
            '[uploadSkillBundle] staging cleanup failed:',
            cleanupErr,
          );
        },
      );
      if (err instanceof ConvexError) throw err;
      throw new ConvexError({
        code: 'WRITE_FAILED',
        message:
          err instanceof Error ? err.message : 'Failed to write skill bundle',
      });
    } finally {
      await cleanupUploadResources(ctx, args.storageId);
      await ctx
        .runMutation(internal.skills.upload_mutations.releaseSkillUploadSlot, {
          organizationId: args.organizationId,
          slug: parsed.slug,
        })
        .catch((err) => {
          console.warn('[uploadSkillBundle] release slot failed:', err);
        });
    }

    const newState: Record<string, unknown> = {
      name: parsed.meta.name,
      description: parsed.meta.description,
      assetCount: parsed.files.length - 1, // SKILL.md doesn't count as an asset
      totalBytes: parsed.totalBytes,
      skillMdHash: parsed.skillMdHash,
    };
    if (parsed.meta.recommendedPackages) {
      newState.recommendedPackages = parsed.meta.recommendedPackages;
    }
    if (parsed.meta.license !== undefined) {
      newState.license = parsed.meta.license;
    }
    if (parsed.meta.disableModelInvocation !== undefined) {
      newState.disableModelInvocation = parsed.meta.disableModelInvocation;
    }

    await logSkillAudit(ctx, auth, 'upload_skill', parsed.slug, {
      resourceName: parsed.meta.name,
      ...(previousCapability !== undefined && {
        previousState: previousCapability,
      }),
      newState,
    });

    // Drop any cached skill snapshot for this org so the next chat send
    // rebuilds with the uploaded content immediately (the mtime probe also
    // catches this, but this avoids any 1s-mtime-resolution race).
    invalidateSkillContextCache(auth.orgSlug);

    return {
      ok: true as const,
      slug: parsed.slug,
      hash: parsed.skillMdHash,
    };
  },
});

/**
 * The built-in skill catalog (`TALE_CONFIG_BUILTIN_DIR/skills/*`) as
 * `{ slug, name, description }` rows — the template list behind the skills
 * page's "From template" create flow. Same discovery posture as
 * `listCatalogAutomations`: an unparseable catalog SKILL.md is warned and skipped,
 * never fails the list; a missing catalog dir yields an empty list.
 */
export const listCatalogSkills = action({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      description: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    // Same gate as the org skills surface this feeds (`listSkills`).
    await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const dir = resolveCatalogSkillsDir();
    const entries = await readdirSafe(dir);
    const slugs = entries.filter(
      (e) => !e.startsWith('.') && validateSkillSlug(e),
    );
    const out: { slug: string; name: string; description: string }[] = [];
    for (const slug of slugs.sort()) {
      const content = await readFileSafe(path.join(dir, slug, 'SKILL.md'));
      if (content === null) continue;
      try {
        const { meta } = parseSkillMd(content);
        out.push({ slug, name: meta.name, description: meta.description });
      } catch (err) {
        console.warn(`[listCatalogSkills] skipping "${slug}":`, err);
      }
    }
    return out;
  },
});

/** Placeholder SKILL.md content for a blank skill — authored bundle content
 *  (not UI copy), edited by the operator right after create. */
const BLANK_SKILL_DESCRIPTION = 'Describe when an agent should use this skill.';
const BLANK_SKILL_BODY = [
  '',
  '# Instructions',
  '',
  'Describe what this skill does and how an agent should apply it.',
  '',
].join('\n');

/**
 * Create a skill bundle in the org's skills dir — either BLANK (a minimal
 * valid SKILL.md: frontmatter `name` + placeholder description/body) or FROM
 * TEMPLATE (a copy of a built-in catalog bundle, `TALE_CONFIG_BUILTIN_DIR/
 * skills/<templateSlug>`, with the frontmatter `name` rewritten to the new
 * slug — same rule the upload path enforces: name == slug == directory).
 *
 * An existing slug is REJECTED (`SKILL_EXISTS`) — replacing content is the
 * upload path's job (it owns the confirm + atomic-swap machinery). Same auth
 * posture as `uploadSkillBundle`: org admin or developer.
 */
export const createSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    /** Built-in catalog skill to copy; absent → a blank skill. */
    templateSlug: v.optional(v.string()),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args): Promise<{ slug: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    if (
      args.templateSlug !== undefined &&
      !validateSkillSlug(args.templateSlug)
    ) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid template slug: ${args.templateSlug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Reject an existing slug outright — even a broken bundle (unreadable
    // SKILL.md) blocks the create, so we never silently merge into or shadow
    // an existing directory.
    const targetDir = resolveSkillDir(auth.orgSlug, args.slug);
    const existingDir = await stat(targetDir).catch(() => null);
    if (existingDir !== null) {
      throw new ConvexError({
        code: 'SKILL_EXISTS',
        message: `A skill named "${args.slug}" already exists`,
      });
    }

    const targetMdPath = resolveSkillMdPath(auth.orgSlug, args.slug);
    let newContent: string;
    let assetCount = 0;
    if (args.templateSlug === undefined) {
      // Blank: a minimal valid SKILL.md the operator edits after create.
      const meta: SkillFrontmatter = {
        name: args.slug,
        description: BLANK_SKILL_DESCRIPTION,
        unknown: {},
      };
      newContent = serializeSkillMd(meta, BLANK_SKILL_BODY);
      await atomicWrite(targetMdPath, newContent);
    } else {
      const templateDir = resolveCatalogSkillDir(args.templateSlug);
      const sourceContent = await readFileSafe(
        path.join(templateDir, 'SKILL.md'),
      );
      if (sourceContent === null) {
        throw new ConvexError({
          code: 'NOT_FOUND',
          message: `Built-in skill "${args.templateSlug}" does not exist`,
        });
      }
      // Re-derive content from parseSkillMd rather than copying raw bytes —
      // catches a malformed catalog file at create-time (mirrors
      // duplicateSkill's rationale).
      let parsed: { meta: SkillFrontmatter; body: string };
      try {
        parsed = parseSkillMd(sourceContent);
      } catch (err) {
        throw new ConvexError({
          code: 'INVALID_SKILL_MD',
          message: `Built-in skill "${args.templateSlug}" has invalid frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      newContent = serializeSkillMd(
        { ...parsed.meta, name: args.slug },
        parsed.body,
      );
      await atomicWrite(targetMdPath, newContent);

      // Copy bundle assets byte-preserving (same best-effort posture as
      // duplicateSkill: a partial copy is still a valid skill).
      const { assets } = await walkSkillBundle(templateDir);
      const skipped: string[] = [];
      for (const asset of assets) {
        const content = await readFileBufferSafe(
          path.join(templateDir, asset.path),
        );
        if (content === null) {
          skipped.push(asset.path);
          continue;
        }
        const targetPath = await resolveSkillAssetPathChecked(
          auth.orgSlug,
          args.slug,
          asset.path,
        );
        await atomicWriteBuffer(targetPath, content);
      }
      if (skipped.length > 0) {
        console.warn(
          `[createSkill] dropped ${skipped.length} unreadable asset(s) from template "${args.templateSlug}" → "${args.slug}":`,
          skipped,
        );
      }
      assetCount = assets.length - skipped.length;
    }

    await logSkillAudit(ctx, auth, 'create_skill', args.slug, {
      resourceName: args.slug,
      newState: {
        name: args.slug,
        assetCount,
        skillMdHash: sha256(newContent),
        ...(args.templateSlug !== undefined && {
          templateSlug: args.templateSlug,
        }),
      },
    });

    invalidateSkillContextCache(auth.orgSlug);

    return { slug: args.slug };
  },
});

export const duplicateSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({ newSlug: v.string() }),
  handler: async (ctx, args): Promise<{ newSlug: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Load the source skill so we can re-serialize with a new slug. We
    // intentionally re-derive content from parseSkillMd rather than
    // copying the raw bytes — that catches malformed source files at
    // duplicate-time instead of letting the new skill inherit corrupt
    // frontmatter and fail later at runtime.
    const sourcePath = resolveSkillMdPath(auth.orgSlug, args.slug);
    const sourceContent = await readFileSafe(sourcePath);
    if (sourceContent === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }
    const { meta, body } = parseSkillMd(sourceContent);

    // Find an unused slug — `<slug>-copy`, `<slug>-copy-2`, etc. Mirrors
    // duplicateAgent's naming so the two surfaces feel identical.
    const baseDir = resolveSkillsDir(auth.orgSlug);
    let entries: string[];
    try {
      entries = await readdirSafe(baseDir);
    } catch (err) {
      // readdirSafe already swallows ENOENT and returns []. Anything that
      // reaches here is a real I/O fault (EACCES / EIO); log so the slug
      // dedup doesn't silently collide on inaccessible state.
      console.warn(
        '[duplicateSkill] readdir failed; treating skills dir as empty:',
        baseDir,
        err,
      );
      entries = [];
    }
    const existing = new Set(entries);
    let newSlug = `${args.slug}-copy`;
    let counter = 2;
    while (existing.has(newSlug)) {
      newSlug = `${args.slug}-copy-${counter}`;
      counter += 1;
    }
    if (!validateSkillSlug(newSlug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Generated copy slug "${newSlug}" is not valid`,
      });
    }

    // Update the frontmatter `name` to match the new slug — the upload
    // path enforces name == slug, and a skill whose name disagrees with
    // its on-disk directory would silently misbehave anyway.
    const newMeta = { ...meta, name: newSlug };
    const newContent = serializeSkillMd(newMeta, body);
    const newSkillMdPath = resolveSkillMdPath(auth.orgSlug, newSlug);
    await atomicWrite(newSkillMdPath, newContent);

    // Copy bundle assets too. Use byte-preserving read+write — readFileSafe
    // / atomicWrite go through a UTF-8 round-trip that corrupts binary
    // assets (PNGs, PDFs, fonts). Best-effort: a partial copy is still a
    // valid skill (assets are optional), and the user can re-upload
    // anything that didn't make it through; aborting on first asset
    // failure would leave behind a half-populated duplicate that's harder
    // to recover from.
    const sourceDir = resolveSkillDir(auth.orgSlug, args.slug);
    const { assets } = await walkSkillBundle(sourceDir);
    const skipped: string[] = [];
    for (const asset of assets) {
      const sourceAssetPath = path.join(sourceDir, asset.path);
      const content = await readFileBufferSafe(sourceAssetPath);
      if (content === null) {
        skipped.push(asset.path);
        continue;
      }
      const targetPath = await resolveSkillAssetPathChecked(
        auth.orgSlug,
        newSlug,
        asset.path,
      );
      await atomicWriteBuffer(targetPath, content);
    }
    if (skipped.length > 0) {
      console.warn(
        `[duplicateSkill] dropped ${skipped.length} unreadable asset(s) from "${args.slug}" → "${newSlug}":`,
        skipped,
      );
    }

    await logSkillAudit(ctx, auth, 'duplicate_skill', newSlug, {
      resourceName: newSlug,
      previousState: { sourceSlug: args.slug },
      newState: {
        name: newMeta.name,
        description: newMeta.description,
        assetCount: assets.length - skipped.length,
        skillMdHash: sha256(newContent),
        ...(skipped.length > 0 && { droppedAssets: skipped }),
        ...(newMeta.recommendedPackages && {
          recommendedPackages: newMeta.recommendedPackages,
        }),
        ...(newMeta.license !== undefined && { license: newMeta.license }),
      },
    });

    invalidateSkillContextCache(auth.orgSlug);

    return { newSlug };
  },
});

export const deleteSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const dir = resolveSkillDir(auth.orgSlug, args.slug);
    const skillMdPath = resolveSkillMdPath(auth.orgSlug, args.slug);

    // CAS guard: the caller can pass the SKILL.md hash they last observed.
    // If the file changed between load and confirm, refuse — the operator
    // may be looking at a stale view of the skill they think they're deleting.
    if (args.expectedHash !== undefined) {
      const current = await readFileSafe(skillMdPath);
      if (current !== null && sha256(current) !== args.expectedHash) {
        throw new ConvexError({
          code: 'CONFLICT',
          message:
            'Skill was modified externally since it was loaded. Reload and reconfirm the delete.',
        });
      }
    }

    // Audit BEFORE the destructive rm so a missing audit row implies the
    // delete didn't happen. `rm({force:true})` swallows ENOENT, so the
    // post-rm branch that used to return `{deleted: false}` was unreachable
    // — we now return `deleted: true` unconditionally on a non-throwing rm.
    await logSkillAudit(ctx, auth, 'delete_skill', args.slug);
    await rm(dir, { recursive: true, force: true });
    invalidateSkillContextCache(auth.orgSlug);
    return { deleted: true };
  },
});

/**
 * Edit a skill's SKILL.md in place — the write surface the create dialog has
 * long promised ("edit from the detail panel") but nothing implemented. Only
 * the frontmatter `description` and the markdown `body` are editable; `name`
 * stays pinned to the slug (renaming a skill is duplicate-then-delete, never an
 * in-place edit, because name == slug == directory is a load-bearing invariant).
 *
 * Every other frontmatter field (unknown community keys, recommendedPackages,
 * license, icon) is re-serialized untouched via a parse→edit→serialize round
 * trip. Guards mirror the rest of the write surface: CAS via `expectedHash`
 * (same as deleteSkill), schema re-validation of the serialized result, the
 * per-file size cap, an audit row, and a skill-context cache invalidation.
 */
export const updateSkillMd = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    description: v.string(),
    body: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ ok: v.literal(true), hash: v.string() }),
  handler: async (ctx, args): Promise<{ ok: true; hash: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const mdPath = resolveSkillMdPath(auth.orgSlug, args.slug);
    const current = await readFileSafe(mdPath);
    if (current === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }

    // CAS guard (mirrors deleteSkill): refuse if the file changed since the
    // editor loaded it, so a stale edit can't clobber a concurrent change.
    if (
      args.expectedHash !== undefined &&
      sha256(current) !== args.expectedHash
    ) {
      throw new ConvexError({
        code: 'CONFLICT',
        message:
          'Skill was modified externally since it was loaded. Reload and reapply your changes.',
      });
    }

    // Re-parse so unknown community fields, recommendedPackages, license, and
    // icon round-trip untouched — we only rewrite description + body.
    let currentMeta: SkillFrontmatter;
    try {
      currentMeta = parseSkillMd(current).meta;
    } catch (err) {
      throw new ConvexError({
        code: 'INVALID_SKILL_MD',
        message: `Current SKILL.md is unreadable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const newMeta: SkillFrontmatter = {
      ...currentMeta,
      description: args.description.trim(),
    };
    const newContent = serializeSkillMd(newMeta, args.body);

    // Validate the serialized result before writing: parseSkillMd enforces the
    // frontmatter schema (description 1..1024, name regex, …) so a bad edit is
    // rejected with a clear message instead of persisting a corrupt bundle.
    try {
      parseSkillMd(newContent);
    } catch (err) {
      throw new ConvexError({
        code: 'INVALID_SKILL_MD',
        message: err instanceof Error ? err.message : String(err),
      });
    }
    if (Buffer.byteLength(newContent, 'utf-8') > MAX_SKILL_BUNDLE_FILE_BYTES) {
      throw new ConvexError({
        code: 'FILE_TOO_LARGE',
        message: `SKILL.md exceeds per-file cap of ${MAX_SKILL_BUNDLE_FILE_BYTES} bytes`,
      });
    }

    await atomicWrite(mdPath, newContent);
    const newHash = sha256(newContent);

    await logSkillAudit(ctx, auth, 'update_skill', args.slug, {
      resourceName: newMeta.name,
      previousState: { description: currentMeta.description },
      newState: { description: newMeta.description, skillMdHash: newHash },
    });

    invalidateSkillContextCache(auth.orgSlug);
    return { ok: true as const, hash: newHash };
  },
});

/**
 * Package an installed skill's on-disk bundle (SKILL.md + every asset) into a
 * downloadable `.zip`, returned base64-encoded. The inverse of
 * `uploadSkillBundle`: it reads bytes byte-for-byte (no UTF-8 round trip, so
 * binary assets survive) and re-applies the same entry/size caps so a
 * hand-edited on-disk bundle can't produce an oversized download.
 */
export const exportSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    ok: v.literal(true),
    filename: v.string(),
    dataBase64: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; filename: string; dataBase64: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const skillDir = resolveSkillDir(orgSlug, args.slug);
    const mdBuf = await readFileBufferSafe(
      resolveSkillMdPath(orgSlug, args.slug),
    );
    if (mdBuf === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }

    const { assets, totalBytes } = await walkSkillBundle(skillDir);
    if (assets.length + 1 > MAX_SKILL_BUNDLE_ENTRIES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle has too many entries (max ${MAX_SKILL_BUNDLE_ENTRIES})`,
      });
    }
    if (totalBytes + mdBuf.length > MAX_SKILL_BUNDLE_TOTAL_BYTES) {
      throw new ConvexError({
        code: 'BUNDLE_TOO_LARGE',
        message: `Bundle exceeds ${MAX_SKILL_BUNDLE_TOTAL_BYTES} bytes`,
      });
    }

    const zip = new JSZip();
    zip.file('SKILL.md', mdBuf);
    for (const asset of assets) {
      const abs = await resolveSkillAssetPathChecked(
        orgSlug,
        args.slug,
        asset.path,
      );
      const buf = await readFileBufferSafe(abs);
      // A file that vanished between walk and read is skipped, not fatal — the
      // export is best-effort byte-for-byte of what's currently on disk.
      if (buf === null) continue;
      zip.file(asset.path, buf);
    }

    const dataBase64 = await zip.generateAsync({ type: 'base64' });
    return {
      ok: true as const,
      filename: `${args.slug}.zip`,
      dataBase64,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal actions used by the chat runtime at turn start:
//   - `listSkillsForExecution(orgSlug)` returns every skill slug present
//     in the org's skills directory (passes the slug validator).
//   - `readSkillForExecution(orgSlug, slug)` loads one skill's full bundle
//     into memory (frontmatter + body + every asset's content) with its
//     versionHash for drift detection.
//
// Trust contract: the caller MUST have already authenticated the `orgSlug`
// against the user's session — these internal actions take the already-
// resolved orgSlug verbatim and do NO membership re-check.
// ---------------------------------------------------------------------------

export const listSkillsForExecution = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const dir = resolveSkillsDir(args.orgSlug);
    const entries = await readdirSafe(dir);
    return entries.filter((e) => !e.startsWith('.') && validateSkillSlug(e));
  },
});

export const readSkillForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      return { ok: false as const, error: 'invalid_slug' as const };
    }
    const result = await readSkillMd(args.orgSlug, args.slug);
    if (!result.ok) return result;

    const dir = resolveSkillDir(args.orgSlug, args.slug);
    const { assets } = await walkSkillBundle(dir);

    const files = await Promise.all(
      assets.map(async (a) => {
        const abs = await resolveSkillAssetPathChecked(
          args.orgSlug,
          args.slug,
          a.path,
        );
        const content = await readFileSafe(abs);
        return content === null
          ? null
          : { path: a.path, content, size: a.size };
      }),
    );

    return {
      ok: true as const,
      slug: args.slug,
      meta: result.meta,
      body: result.body,
      versionHash: result.versionHash,
      files: files.filter((f): f is NonNullable<typeof f> => f !== null),
    };
  },
});
