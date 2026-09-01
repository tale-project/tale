import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { Sql } from 'postgres';

import { brandingJsonSchema } from '../../../lib/shared/schemas/branding.ts';
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
  sha256,
  validateImageType,
  type BrandingJsonConfig,
  type BrandingReadResult,
} from '../../core/branding/file_utils.ts';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
} from '../../core/lib/file_io.ts';

/**
 * Branding file I/O — the 0.5 twin of `convex/branding/file_actions.ts`
 * with the file layer (path safety, atomic writes, history retention)
 * REUSED verbatim; only the auth/slug resolution moved to the routes. The
 * image files themselves stay served by the shell's static handler
 * (`vite-plugins/serve-branding-images.ts`) — the URL builder is shared.
 */

const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

/** Platform-wide bucket read by the pre-auth shell when no org is in scope. */
export const DEFAULT_ORG_SLUG = 'default';

export class BrandingError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;
  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'BrandingError';
    this.code = code;
    this.status = status;
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

export interface BrandingView {
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

/** Display-only read: the org's bucket when it resolves, else the platform
 * `default` bucket (the pre-auth shell / stale-bookmark posture). */
export async function readBranding(
  sql: Sql,
  organizationId: string | undefined,
): Promise<BrandingView> {
  let orgSlug = DEFAULT_ORG_SLUG;
  let appName: string | undefined;
  if (organizationId !== undefined && organizationId !== '') {
    const rows = await sql<{ slug: string | null; name: string | null }[]>`
      SELECT "slug", "name" FROM "organization"
      WHERE "id" = ${organizationId} LIMIT 1
    `;
    const org = rows[0];
    if (org?.slug != null) {
      orgSlug = org.slug;
      appName = org.name ?? undefined;
    } else {
      const shownId =
        organizationId.length > 64
          ? `${organizationId.slice(0, 64)}… (${organizationId.length} chars)`
          : organizationId;
      console.warn(
        `[branding] unresolvable organization ${JSON.stringify(shownId)}; serving default branding`,
      );
    }
  }
  const fileResult = await readBrandingFile(orgSlug);
  if (fileResult.ok) {
    const config = fileResult.config;
    return {
      ...(appName !== undefined ? { appName } : {}),
      // A file the 0.3.4/01 migration hasn't rewritten may still carry only
      // the legacy `brandColor` — coalesce so the saved color keeps effect.
      ...(config.accentColor || config.brandColor
        ? { accentColor: config.accentColor || config.brandColor }
        : {}),
      logoUrl: buildBrandingImageUrl(orgSlug, config.logoFilename),
      faviconLightUrl: buildBrandingImageUrl(
        orgSlug,
        config.faviconLightFilename,
      ),
      faviconDarkUrl: buildBrandingImageUrl(
        orgSlug,
        config.faviconDarkFilename,
      ),
      ...(config.logoFilename !== undefined
        ? { logoFilename: config.logoFilename }
        : {}),
      ...(config.faviconLightFilename !== undefined
        ? { faviconLightFilename: config.faviconLightFilename }
        : {}),
      ...(config.faviconDarkFilename !== undefined
        ? { faviconDarkFilename: config.faviconDarkFilename }
        : {}),
      hash: fileResult.hash,
    };
  }
  if (fileResult.error !== 'not_found') {
    console.error(
      `[branding] failed to read branding file for "${orgSlug}":`,
      fileResult.message,
    );
  }
  return {
    ...(appName !== undefined ? { appName } : {}),
    logoUrl: null,
    faviconLightUrl: null,
    faviconDarkUrl: null,
    hash: '',
  };
}

export async function saveBranding(
  orgSlug: string,
  config: unknown,
): Promise<{ hash: string }> {
  const parsed = brandingJsonSchema.parse(config);
  const content = serializeBrandingJson(parsed);
  await atomicWrite(resolveBrandingFilePath(orgSlug), content);
  return { hash: sha256(content) };
}

export async function saveBrandingImage(
  orgSlug: string,
  args: { type: string; base64: string; mimeType: string },
): Promise<{ filename: string }> {
  if (!validateImageType(args.type)) {
    throw new BrandingError(
      'IMAGE_TYPE_INVALID',
      `Invalid image type: ${args.type}`,
    );
  }
  const ext = mimeToExtension(args.mimeType);
  if (!ext) {
    throw new BrandingError(
      'IMAGE_MIME_UNSUPPORTED',
      `Unsupported image MIME type: ${args.mimeType}`,
    );
  }
  const buffer = Buffer.from(args.base64, 'base64');
  if (buffer.length > MAX_IMAGE_SIZE_BYTES) {
    throw new BrandingError(
      'IMAGE_TOO_LARGE',
      `Image exceeds maximum size of ${MAX_IMAGE_SIZE_BYTES} bytes`,
    );
  }
  const filename = `${args.type}.${ext}`;
  const imagesDir = resolveImagesDir(orgSlug);
  await mkdir(imagesDir, { recursive: true });
  await removeImageVariants(imagesDir, args.type, 'saveBrandingImage');
  await atomicWriteBuffer(resolveImagePath(orgSlug, filename), buffer);
  return { filename };
}

/** Remove any existing file for this image type (may differ in extension).
 * Tolerates ENOENT (first write); logs everything else. */
async function removeImageVariants(
  imagesDir: string,
  type: string,
  caller: string,
): Promise<void> {
  try {
    const existing = await readdir(imagesDir);
    for (const entry of existing) {
      if (entry.startsWith(`${type}.`)) {
        await unlink(path.join(imagesDir, entry));
      }
    }
  } catch (err) {
    if (errnoCode(err) !== 'ENOENT') {
      console.warn(`[${caller}] readdir ${imagesDir} failed:`, err);
    }
  }
}

export async function deleteBrandingImage(
  orgSlug: string,
  type: string,
): Promise<void> {
  if (!validateImageType(type)) {
    throw new BrandingError(
      'IMAGE_TYPE_INVALID',
      `Invalid image type: ${type}`,
    );
  }
  await removeImageVariants(
    resolveImagesDir(orgSlug),
    type,
    'deleteBrandingImage',
  );
}

export async function resetBranding(orgSlug: string): Promise<void> {
  await atomicWrite(
    resolveBrandingFilePath(orgSlug),
    serializeBrandingJson({}),
  );
  const imagesDir = resolveImagesDir(orgSlug);
  try {
    const entries = await readdir(imagesDir);
    await Promise.all(
      entries.map((entry) => {
        const file = path.join(imagesDir, entry);
        return unlink(file).catch((err: unknown) => {
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
}

export async function snapshotBrandingToHistory(
  orgSlug: string,
): Promise<{ timestamp: string } | null> {
  const currentContent = await readFileSafe(resolveBrandingFilePath(orgSlug));
  if (!currentContent) return null;
  const historyDir = resolveHistoryDir(orgSlug);
  await mkdir(historyDir, { recursive: true });
  const timestamp = generateHistoryTimestamp();
  await atomicWrite(path.join(historyDir, `${timestamp}.json`), currentContent);
  await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  return { timestamp };
}
