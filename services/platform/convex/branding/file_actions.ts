'use node';

/**
 * Branding file I/O actions — per organization.
 *
 * Each org owns a branding.json + images under its own subtree:
 * {TALE_CONFIG_DIR}/<orgSlug>/branding/{branding.json,images/}. The public
 * actions take an `organizationId`; the slug is resolved server-side (never
 * trusted from the client) and used for the on-disk path. Writes require the
 * caller to hold the `orgSettings` capability in that org — matching the
 * branding settings page's route gate — so one org's admin can't restyle
 * another. Reads are display-only (logo/colors/app name) and resolve the slug
 * without a membership gate to stay off the auth-latency path; omitting
 * `organizationId` reads the platform `default` bucket, which backs the
 * pre-auth shell (login page) where no org is in scope yet.
 *
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 10-entry retention.
 */

import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { brandingJsonSchema } from '../../lib/shared/schemas/branding';
import type { ActionCtx } from '../_generated/server';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  atomicWriteBuffer,
  generateHistoryTimestamp,
  errnoCode,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import {
  isOrgSlugUnresolvable,
  orgIdentityFromId,
  type OrgIdentity,
} from '../lib/helpers/org_slug';
import type { BrandingJsonConfig, BrandingReadResult } from './file_utils';
import {
  buildBrandingImageUrl,
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  mimeToExtension,
  parseBrandingJson,
  resolveBrandingFilePath,
  resolveHistoryDir,
  resolveImagePath,
  resolveImagesDir,
  serializeBrandingJson,
  validateImageType,
} from './file_utils';

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Platform-wide bucket read by the pre-auth shell when no org is in scope. */
const DEFAULT_ORG_SLUG = 'default';

/**
 * Authenticate the caller, verify membership in `organizationId`, and require
 * the `orgSettings` capability there (the same gate the branding settings page
 * applies on the client). Returns the resolved slug for the on-disk path.
 * Throws a `ConvexError` with a stable `code` so the UI can dispatch:
 * `UNAUTHENTICATED`, `ORG_NOT_FOUND`, or `ORG_FORBIDDEN`.
 */
async function requireBrandingAdmin(
  ctx: ActionCtx,
  organizationId: string,
): Promise<{ orgSlug: string }> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  if (defineAbilityFor(auth.member.role).cannot('write', 'orgSettings')) {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: `Role "${auth.member.role}" lacks the org-settings capability required to modify branding.`,
    });
  }
  return { orgSlug: auth.orgSlug };
}

async function readBrandingFile(orgSlug: string): Promise<BrandingReadResult> {
  const filePath = resolveBrandingFilePath(orgSlug);
  const result = await readJsonFile<BrandingJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseBrandingJson,
  );
  if (result.ok) {
    return { ok: true, config: result.data, hash: result.hash };
  }
  return result;
}

interface BrandingResult {
  appName?: string;
  accentColor?: string;
  logoUrl: string | null;
  faviconLightUrl: string | null;
  faviconDarkUrl: string | null;
  logoFilename?: string;
  faviconLightFilename?: string;
  faviconDarkFilename?: string;
  hash: string;
}

export const readBranding = action({
  // `organizationId` optional: omitted reads the platform `default` bucket
  // (pre-auth shell); provided reads that org's branding. Display-only data,
  // so no membership gate — only the slug resolution, which already validates
  // the org exists.
  args: { organizationId: v.optional(v.string()) },
  returns: v.object({
    appName: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    logoUrl: v.union(v.string(), v.null()),
    faviconLightUrl: v.union(v.string(), v.null()),
    faviconDarkUrl: v.union(v.string(), v.null()),
    logoFilename: v.optional(v.string()),
    faviconLightFilename: v.optional(v.string()),
    faviconDarkFilename: v.optional(v.string()),
    hash: v.string(),
  }),
  handler: async (ctx, args): Promise<BrandingResult> => {
    // The app name is the organization's own name (resolved here), not a
    // stored branding field — one source of truth for "what the org is
    // called". The pre-auth `default` bucket has no org, so no app name.
    let identity: OrgIdentity | null = null;
    if (args.organizationId) {
      const organizationId = args.organizationId;
      try {
        identity = await orgIdentityFromId(ctx, organizationId);
      } catch (err) {
        // A stale tab/bookmark keeps requesting a deleted org's branding until
        // the dashboard bounces it away — a terminal miss here is routine, not
        // a server fault, so serve the platform `default` bucket instead of an
        // uncaught throw. Transient transport errors still propagate.
        if (!isOrgSlugUnresolvable(err)) throw err;
        // Echo at most 64 chars of the id: this action is unauthenticated and
        // the arg is an unbounded string, so a verbatim echo would let junk-id
        // probes pump arbitrary bytes into the log on every request.
        const shownId =
          organizationId.length > 64
            ? `${organizationId.slice(0, 64)}… (${organizationId.length} chars)`
            : organizationId;
        console.warn(
          `[Branding] readBranding: unresolvable organization (${err.reason}) ${JSON.stringify(shownId)}; serving default branding`,
        );
      }
    }
    const orgSlug = identity?.slug ?? DEFAULT_ORG_SLUG;
    const fileResult = await readBrandingFile(orgSlug);

    if (fileResult.ok) {
      const config = fileResult.config;
      return {
        appName: identity?.name,
        // The single accent color drives the derived palette (#1960). A file
        // the 0.3.4/01 migration hasn't rewritten yet may still carry only the
        // legacy `brandColor` — coalesce so the saved color keeps its effect
        // (`''` means unset for both fields).
        accentColor: config.accentColor || config.brandColor || undefined,
        logoUrl: buildBrandingImageUrl(orgSlug, config.logoFilename),
        faviconLightUrl: buildBrandingImageUrl(
          orgSlug,
          config.faviconLightFilename,
        ),
        faviconDarkUrl: buildBrandingImageUrl(
          orgSlug,
          config.faviconDarkFilename,
        ),
        logoFilename: config.logoFilename,
        faviconLightFilename: config.faviconLightFilename,
        faviconDarkFilename: config.faviconDarkFilename,
        hash: fileResult.hash,
      };
    }

    if (fileResult.error !== 'not_found') {
      console.error(
        `[Branding] Failed to read branding file for "${orgSlug}":`,
        fileResult.message,
      );
    }

    return {
      appName: identity?.name,
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      hash: '',
    };
  },
});

export const saveBranding = action({
  args: {
    organizationId: v.string(),
    config: v.object({
      accentColor: v.optional(v.string()),
      logoFilename: v.optional(v.string()),
      faviconLightFilename: v.optional(v.string()),
      faviconDarkFilename: v.optional(v.string()),
    }),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const { orgSlug } = await requireBrandingAdmin(ctx, args.organizationId);

    const config = brandingJsonSchema.parse(args.config);
    const content = serializeBrandingJson(config);
    const filePath = resolveBrandingFilePath(orgSlug);

    await atomicWrite(filePath, content);

    return { hash: sha256(content) };
  },
});

export const saveImage = action({
  args: {
    organizationId: v.string(),
    type: v.string(),
    base64: v.string(),
    mimeType: v.string(),
  },
  returns: v.object({ filename: v.string() }),
  handler: async (ctx, args): Promise<{ filename: string }> => {
    const { orgSlug } = await requireBrandingAdmin(ctx, args.organizationId);

    // Validation failures throw `ConvexError` with a stable `code` (not a raw
    // `Error`, whose message Convex scrubs to "Server Error" before it reaches
    // the client) so the upload UI can surface a precise, localized toast.
    if (!validateImageType(args.type)) {
      throw new ConvexError({
        code: 'IMAGE_TYPE_INVALID',
        message: `Invalid image type: ${args.type}`,
      });
    }

    const ext = mimeToExtension(args.mimeType);
    if (!ext) {
      throw new ConvexError({
        code: 'IMAGE_MIME_UNSUPPORTED',
        message: `Unsupported image MIME type: ${args.mimeType}`,
      });
    }

    const buffer = Buffer.from(args.base64, 'base64');
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new ConvexError({
        code: 'IMAGE_TOO_LARGE',
        message: `Image exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES} bytes`,
        maxBytes: MAX_IMAGE_SIZE_BYTES,
      });
    }

    const filename = `${args.type}.${ext}`;
    const imagesDir = resolveImagesDir(orgSlug);
    await mkdir(imagesDir, { recursive: true });

    // Remove any existing file for this image type (may have different
    // extension). Tolerate ENOENT (first-write); log everything else
    // so permission/IO bugs don't leak stale image files unnoticed.
    try {
      const existing = await readdir(imagesDir);
      for (const entry of existing) {
        if (entry.startsWith(`${args.type}.`)) {
          await unlink(path.join(imagesDir, entry));
        }
      }
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(`[saveImage] readdir ${imagesDir} failed:`, err);
      }
    }

    const filePath = resolveImagePath(orgSlug, filename);
    await atomicWriteBuffer(filePath, buffer);

    return { filename };
  },
});

export const deleteImage = action({
  args: {
    organizationId: v.string(),
    type: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { orgSlug } = await requireBrandingAdmin(ctx, args.organizationId);

    if (!validateImageType(args.type)) {
      throw new ConvexError({
        code: 'IMAGE_TYPE_INVALID',
        message: `Invalid image type: ${args.type}`,
      });
    }

    const imagesDir = resolveImagesDir(orgSlug);
    try {
      const existing = await readdir(imagesDir);
      for (const entry of existing) {
        if (entry.startsWith(`${args.type}.`)) {
          await unlink(path.join(imagesDir, entry));
        }
      }
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(`[deleteImage] readdir ${imagesDir} failed:`, err);
      }
    }

    return null;
  },
});

export const resetBranding = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { orgSlug } = await requireBrandingAdmin(ctx, args.organizationId);

    const filePath = resolveBrandingFilePath(orgSlug);
    const content = serializeBrandingJson({});
    await atomicWrite(filePath, content);

    // Remove all image files
    const imagesDir = resolveImagesDir(orgSlug);
    try {
      const entries = await readdir(imagesDir);
      await Promise.all(
        entries.map((entry) => {
          const file = path.join(imagesDir, entry);
          return unlink(file).catch((err) => {
            // Tolerate ENOENT (race with another deleter) and log
            // everything else — silent unlink failures hide permission
            // bugs that leak stale branding images.
            if (errnoCode(err) === 'ENOENT') return;
            console.warn(`[resetBranding] unlink ${file} failed:`, err);
          });
        }),
      );
    } catch (err) {
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(`[resetBranding] readdir ${imagesDir} failed:`, err);
      }
    }

    return null;
  },
});

export const snapshotToHistory = action({
  args: { organizationId: v.string() },
  returns: v.union(v.object({ timestamp: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ timestamp: string } | null> => {
    const { orgSlug } = await requireBrandingAdmin(ctx, args.organizationId);

    const filePath = resolveBrandingFilePath(orgSlug);
    const currentContent = await readFileSafe(filePath);
    if (!currentContent) return null;

    const historyDir = resolveHistoryDir(orgSlug);
    await mkdir(historyDir, { recursive: true });

    const timestamp = generateHistoryTimestamp();
    const historyPath = path.join(historyDir, `${timestamp}.json`);
    await atomicWrite(historyPath, currentContent);

    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);

    return { timestamp };
  },
});
