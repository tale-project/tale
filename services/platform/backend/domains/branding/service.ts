import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import { brandingJsonSchema } from '@tale/shared/schemas/branding';
import type { Sql } from 'postgres';

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
  svgHasActiveContent,
  validateImageType,
  type BrandingImageType,
  type BrandingJsonConfig,
  type BrandingReadResult,
} from '../../core/branding/file_utils.ts';
import {
  assertExpectedHash,
  configSnapshot,
} from '../../core/lib/config_store/precondition';
import { withConfigWriteLock } from '../../core/lib/config_store/write_lock.ts';
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

export async function readBrandingConfig(orgSlug: string) {
  return configSnapshot(
    await readJsonFile(
      resolveBrandingFilePath(orgSlug),
      MAX_FILE_SIZE_BYTES,
      parseBrandingJson,
    ),
  );
}

export async function saveBranding(
  sql: Sql,
  orgSlug: string,
  config: unknown,
  expectedHash?: string | null,
): Promise<{ hash: string }> {
  const parsed = brandingJsonSchema.parse(config);
  const content = serializeBrandingJson(parsed);
  await withConfigWriteLock(sql, orgSlug, 'branding', async () => {
    if (expectedHash !== undefined)
      assertExpectedHash(
        (await readBrandingConfig(orgSlug)).hash,
        expectedHash,
      );
    await atomicWrite(resolveBrandingFilePath(orgSlug), content);
  });
  return { hash: sha256(content) };
}

export async function saveBrandingImage(
  sql: Sql,
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
  // Intake nicety for the stored-XSS class: refuse SVGs carrying scripting
  // vectors with a precise error. The serving side stays the guarantee —
  // branding images are delivered under a `sandbox` CSP either way (see
  // svgHasActiveContent's doc comment).
  if (ext === 'svg' && svgHasActiveContent(buffer.toString('utf8'))) {
    throw new BrandingError(
      'IMAGE_SVG_ACTIVE_CONTENT',
      'SVG contains scripts, event handlers, or javascript: URLs',
    );
  }
  // Narrowed here: the guard above does not reach into the closure below.
  const imageType: BrandingImageType = args.type;
  const filename = `${imageType}.${ext}`;
  const imagesDir = resolveImagesDir(orgSlug);
  // Replacing an image is a delete-then-write across extensions: two saves
  // of the same type interleaving there leave the loser's file beside the
  // winner's, and the reader picks by prefix.
  await withConfigWriteLock(sql, orgSlug, 'branding', async () => {
    await mkdir(imagesDir, { recursive: true });
    await removeImageVariants(imagesDir, imageType, 'saveBrandingImage');
    await atomicWriteBuffer(resolveImagePath(orgSlug, filename), buffer);
    await writeImageReference(orgSlug, imageType, filename);
  });
  return { filename };
}

/** The config field that names an image type's stored file. */
function imageReferenceField(
  type: BrandingImageType,
): 'logoFilename' | 'faviconLightFilename' | 'faviconDarkFilename' {
  if (type === 'logo') return 'logoFilename';
  if (type === 'favicon-light') return 'faviconLightFilename';
  return 'faviconDarkFilename';
}

/**
 * Points the branding config at the image just written (or forgets it). An
 * upload takes effect the moment it lands — the documented contract — so the
 * reference cannot wait for the settings header's Save: a reload before that
 * Save used to show the default again, and a replacement across extensions
 * left the config naming a file the write had removed. Runs under the
 * caller's write lock.
 */
async function writeImageReference(
  orgSlug: string,
  type: BrandingImageType,
  filename: string | undefined,
): Promise<void> {
  const current = await readBrandingFile(orgSlug);
  if (!current.ok && current.error !== 'not_found') {
    throw new BrandingError(
      'BRANDING_CONFIG_UNREADABLE',
      `Cannot update the branding config for "${orgSlug}": ${current.message}`,
    );
  }
  const field = imageReferenceField(type);
  const { [field]: _previous, ...rest } = current.ok ? current.config : {};
  const next = brandingJsonSchema.parse(
    filename === undefined ? rest : { ...rest, [field]: filename },
  );
  await atomicWrite(
    resolveBrandingFilePath(orgSlug),
    serializeBrandingJson(next),
  );
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
  sql: Sql,
  orgSlug: string,
  type: string,
): Promise<void> {
  if (!validateImageType(type)) {
    throw new BrandingError(
      'IMAGE_TYPE_INVALID',
      `Invalid image type: ${type}`,
    );
  }
  // Narrowed here: the guard above does not reach into the closure.
  const imageType: BrandingImageType = type;
  await withConfigWriteLock(sql, orgSlug, 'branding', async () => {
    await removeImageVariants(
      resolveImagesDir(orgSlug),
      imageType,
      'deleteBrandingImage',
    );
    await writeImageReference(orgSlug, imageType, undefined);
  });
}

export async function snapshotBrandingToHistory(
  sql: Sql,
  orgSlug: string,
): Promise<{ timestamp: string } | null> {
  // Read → write → prune: without the lock two snapshots can share a
  // timestamp, and a prune can drop an entry another is still writing.
  return withConfigWriteLock(sql, orgSlug, 'branding', async () => {
    const currentContent = await readFileSafe(resolveBrandingFilePath(orgSlug));
    if (!currentContent) return null;
    const historyDir = resolveHistoryDir(orgSlug);
    await mkdir(historyDir, { recursive: true });
    const timestamp = generateHistoryTimestamp();
    await atomicWrite(
      path.join(historyDir, `${timestamp}.json`),
      currentContent,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    return { timestamp };
  });
}
