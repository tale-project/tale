'use node';

/**
 * Branding file I/O actions.
 *
 * Branding is global (not org-scoped). A single branding.json file
 * at {TALE_CONFIG_DIR}/branding/branding.json applies to the entire platform.
 * Image bindings (logo, favicons) use a fixed 'global' key in the DB.
 *
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 10-entry retention.
 */

import { v } from 'convex/values';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { BrandingJsonConfig, BrandingReadResult } from './file_utils';

import { brandingJsonSchema } from '../../lib/shared/schemas/branding';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  parseBrandingJson,
  resolveBrandingFilePath,
  resolveHistoryDir,
  serializeBrandingJson,
} from './file_utils';

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
  textLogo?: string;
  brandColor?: string;
  accentColor?: string;
  logoUrl: string | null;
  faviconLightUrl: string | null;
  faviconDarkUrl: string | null;
  hash: string;
}

export const readBranding = action({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<BrandingResult> => {
    const [fileResult, bindings] = await Promise.all([
      readBrandingFile('default'),
      ctx.runQuery(internal.branding.internal_queries.getBindingsWithUrls, {}),
    ]);

    const config: Partial<BrandingJsonConfig> = fileResult.ok
      ? fileResult.config
      : {};
    const hash = fileResult.ok ? fileResult.hash : '';

    return {
      appName: config.appName,
      textLogo: config.textLogo,
      brandColor: config.brandColor,
      accentColor: config.accentColor,
      logoUrl: bindings?.logoUrl ?? null,
      faviconLightUrl: bindings?.faviconLightUrl ?? null,
      faviconDarkUrl: bindings?.faviconDarkUrl ?? null,
      hash,
    };
  },
});

export const saveBranding = action({
  args: {
    config: v.any(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const config = brandingJsonSchema.parse(args.config);
    const content = serializeBrandingJson(config);
    const filePath = resolveBrandingFilePath('default');

    await atomicWrite(filePath, content);

    return { hash: sha256(content) };
  },
});

export const resetBranding = action({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const filePath = resolveBrandingFilePath('default');
    const content = serializeBrandingJson({});
    await atomicWrite(filePath, content);

    return null;
  },
});

export const snapshotToHistory = action({
  args: {},
  returns: v.union(v.object({ timestamp: v.string() }), v.null()),
  handler: async (ctx): Promise<{ timestamp: string } | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

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
