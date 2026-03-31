'use node';

/**
 * Branding file I/O actions.
 *
 * Branding is global (not org-scoped). A single branding.json file
 * at {TALE_CONFIG_DIR}/branding/branding.json applies to the entire platform.
 * Images (logo, favicons) are stored on disk at {TALE_CONFIG_DIR}/branding/images/.
 *
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 10-entry retention.
 */

import { v } from 'convex/values';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { ActionCtx } from '../_generated/server';
import type { BrandingJsonConfig, BrandingReadResult } from './file_utils';

import { brandingJsonSchema } from '../../lib/shared/schemas/branding';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import {
  atomicWrite,
  atomicWriteBuffer,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { getTrustedAuthData } from '../lib/rls/auth/get_trusted_auth_data';
import { isAdmin } from '../lib/rls/helpers/role_helpers';
import {
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

async function requireBrandingAdmin(ctx: ActionCtx): Promise<void> {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) throw new Error('Unauthenticated');

  const trustedData = await getTrustedAuthData(ctx);
  if (trustedData) {
    if (!isAdmin(trustedData.trustedRole)) {
      throw new Error('Only admins can modify branding');
    }
    return;
  }

  const isUserAdmin = await ctx.runQuery(
    internal.branding.internal_queries.isCallerAdmin,
    { userId: String(authUser._id) },
  );
  if (!isUserAdmin) {
    throw new Error('Only admins can modify branding');
  }
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

function buildImageUrl(filename: string | undefined): string | null {
  if (!filename) return null;
  const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
  const basePath = process.env.BASE_PATH ?? '';
  return `${siteUrl}${basePath}/branding/images/${filename}`;
}

interface BrandingResult {
  appName?: string;
  textLogo?: string;
  brandColor?: string;
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
  args: {},
  returns: v.object({
    appName: v.optional(v.string()),
    textLogo: v.optional(v.string()),
    brandColor: v.optional(v.string()),
    accentColor: v.optional(v.string()),
    logoUrl: v.union(v.string(), v.null()),
    faviconLightUrl: v.union(v.string(), v.null()),
    faviconDarkUrl: v.union(v.string(), v.null()),
    logoFilename: v.optional(v.string()),
    faviconLightFilename: v.optional(v.string()),
    faviconDarkFilename: v.optional(v.string()),
    hash: v.string(),
  }),
  handler: async (ctx): Promise<BrandingResult> => {
    const fileResult = await readBrandingFile('default');

    if (fileResult.ok) {
      const config = fileResult.config;
      return {
        appName: config.appName,
        textLogo: config.textLogo,
        brandColor: config.brandColor,
        accentColor: config.accentColor,
        logoUrl: buildImageUrl(config.logoFilename),
        faviconLightUrl: buildImageUrl(config.faviconLightFilename),
        faviconDarkUrl: buildImageUrl(config.faviconDarkFilename),
        logoFilename: config.logoFilename,
        faviconLightFilename: config.faviconLightFilename,
        faviconDarkFilename: config.faviconDarkFilename,
        hash: fileResult.hash,
      };
    }

    if (!fileResult.ok && fileResult.error !== 'not_found') {
      console.error(
        '[Branding] Failed to read branding file:',
        fileResult.message,
      );
    }

    const legacy = await ctx.runQuery(
      internal.branding.internal_queries.getLegacyBranding,
      {},
    );
    if (legacy) {
      return {
        appName: legacy.appName ?? undefined,
        textLogo: legacy.textLogo ?? undefined,
        brandColor: legacy.brandColor ?? undefined,
        accentColor: legacy.accentColor ?? undefined,
        logoUrl: legacy.logoUrl,
        faviconLightUrl: legacy.faviconLightUrl,
        faviconDarkUrl: legacy.faviconDarkUrl,
        hash: '',
      };
    }

    return {
      logoUrl: null,
      faviconLightUrl: null,
      faviconDarkUrl: null,
      hash: '',
    };
  },
});

export const saveBranding = action({
  args: {
    config: v.object({
      appName: v.optional(v.string()),
      textLogo: v.optional(v.string()),
      brandColor: v.optional(v.string()),
      accentColor: v.optional(v.string()),
      logoFilename: v.optional(v.string()),
      faviconLightFilename: v.optional(v.string()),
      faviconDarkFilename: v.optional(v.string()),
    }),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    await requireBrandingAdmin(ctx);

    const config = brandingJsonSchema.parse(args.config);
    const content = serializeBrandingJson(config);
    const filePath = resolveBrandingFilePath('default');

    await atomicWrite(filePath, content);

    return { hash: sha256(content) };
  },
});

export const saveImage = action({
  args: {
    type: v.string(),
    base64: v.string(),
    mimeType: v.string(),
  },
  returns: v.object({ filename: v.string() }),
  handler: async (ctx, args): Promise<{ filename: string }> => {
    await requireBrandingAdmin(ctx);

    if (!validateImageType(args.type)) {
      throw new Error(`Invalid image type: ${args.type}`);
    }

    const ext = mimeToExtension(args.mimeType);
    if (!ext) {
      throw new Error(`Unsupported image MIME type: ${args.mimeType}`);
    }

    const buffer = Buffer.from(args.base64, 'base64');
    if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `Image exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES} bytes`,
      );
    }

    const filename = `${args.type}.${ext}`;
    const imagesDir = resolveImagesDir('default');
    await mkdir(imagesDir, { recursive: true });

    // Remove any existing file for this image type (may have different extension)
    try {
      const existing = await readdir(imagesDir);
      for (const entry of existing) {
        if (entry.startsWith(`${args.type}.`)) {
          await unlink(path.join(imagesDir, entry));
        }
      }
    } catch {
      // Directory may not exist yet
    }

    const filePath = resolveImagePath('default', filename);
    await atomicWriteBuffer(filePath, buffer);

    return { filename };
  },
});

export const deleteImage = action({
  args: {
    type: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireBrandingAdmin(ctx);

    if (!validateImageType(args.type)) {
      throw new Error(`Invalid image type: ${args.type}`);
    }

    const imagesDir = resolveImagesDir('default');
    try {
      const existing = await readdir(imagesDir);
      for (const entry of existing) {
        if (entry.startsWith(`${args.type}.`)) {
          await unlink(path.join(imagesDir, entry));
        }
      }
    } catch {
      // Directory may not exist
    }

    return null;
  },
});

export const resetBranding = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    await requireBrandingAdmin(ctx);

    const filePath = resolveBrandingFilePath('default');
    const content = serializeBrandingJson({});
    await atomicWrite(filePath, content);

    // Remove all image files
    const imagesDir = resolveImagesDir('default');
    try {
      const entries = await readdir(imagesDir);
      await Promise.all(
        entries.map((entry) =>
          unlink(path.join(imagesDir, entry)).catch(() => {}),
        ),
      );
    } catch {
      // Directory may not exist
    }

    return null;
  },
});

export const snapshotToHistory = action({
  args: {},
  returns: v.union(v.object({ timestamp: v.string() }), v.null()),
  handler: async (ctx): Promise<{ timestamp: string } | null> => {
    await requireBrandingAdmin(ctx);

    const filePath = resolveBrandingFilePath('default');
    const currentContent = await readFileSafe(filePath);
    if (!currentContent) return null;

    const historyDir = resolveHistoryDir('default');
    await mkdir(historyDir, { recursive: true });

    const timestamp = generateHistoryTimestamp();
    const historyPath = path.join(historyDir, `${timestamp}.json`);
    await atomicWrite(historyPath, currentContent);

    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);

    return { timestamp };
  },
});
