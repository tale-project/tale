'use node';

/**
 * Branding JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing branding JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import {
  brandingJsonSchema,
  type BrandingJsonConfig,
} from '../../../lib/shared/schemas/branding';
import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';

export type { BrandingJsonConfig };

export { sha256 };

const MAX_FILE_SIZE_BYTES = 64 * 1024; // 64 KB
const MAX_HISTORY_ENTRIES = 10;
const BRANDING_FILE_NAME = 'branding.json';

export type BrandingReadResult =
  | { ok: true; config: BrandingJsonConfig; hash: string }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

/**
 * Resolve the branding directory for an organization. Org-first:
 * `${TALE_CONFIG_DIR}/<orgSlug>/branding/`. Every org reads its OWN branding
 * (no cross-org fallback); `readBranding` reads the platform `default` bucket
 * only for the pre-auth shell and for org ids that no longer resolve
 * (deleted org / stale bookmark, #3019).
 */
export function resolveBrandingDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('branding'), orgSlug, 'branding');
}

export function resolveBrandingFilePath(orgSlug: string): string {
  return safeJoinWithinDir(resolveBrandingDir(orgSlug), BRANDING_FILE_NAME);
}

export function resolveHistoryDir(orgSlug: string): string {
  return path.join(resolveBrandingDir(orgSlug), '.history', 'branding');
}

export function serializeBrandingJson(config: BrandingJsonConfig): string {
  return serializeJson(config);
}

export function parseBrandingJson(content: string): BrandingJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = brandingJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid branding JSON', result.error));
  }
  return result.data;
}

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  'png',
  'svg',
  'jpg',
  'jpeg',
  'webp',
  'ico',
]);

const IMAGE_TYPE_NAMES = new Set(['logo', 'favicon-light', 'favicon-dark']);

const SAFE_IMAGE_FILENAME_RE = /^[a-z0-9-]+\.[a-z]+$/;

export type BrandingImageType = 'logo' | 'favicon-light' | 'favicon-dark';

export function validateImageType(type: string): type is BrandingImageType {
  return IMAGE_TYPE_NAMES.has(type);
}

export function validateImageFilename(filename: string): boolean {
  if (!SAFE_IMAGE_FILENAME_RE.test(filename)) return false;
  const ext = filename.split('.').pop();
  if (!ext) return false;
  return ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

/**
 * Best-effort detector for ACTIVE content in an SVG upload: script elements
 * (namespace-prefixed included), `on*=` event-handler attributes, and
 * `javascript:` URLs. Branding accepts SVG logos from org admins, and an SVG
 * is a full document when navigated to — this rejects the obvious scripting
 * vectors at intake with a clear error instead of storing them.
 *
 * DEFENSE LAYERING: this is a UX nicety, not the guarantee. XML entity
 * tricks can smuggle markup past any regex — the guarantee is the serving
 * side, which delivers branding images under `Content-Security-Policy:
 * sandbox` so a navigated SVG can never script (see server.ts and
 * vite-plugins/serve-branding-images.ts).
 */
export function svgHasActiveContent(svgText: string): boolean {
  return (
    /<\s*(?:[a-z0-9]+:)?script[\s>/]/i.test(svgText) ||
    /\bon\w+\s*=/i.test(svgText) ||
    /javascript\s*:/i.test(svgText)
  );
}

export function mimeToExtension(mimeType: string): string | null {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
  };
  return map[mimeType] ?? null;
}

export function resolveImagesDir(orgSlug: string): string {
  return path.join(resolveBrandingDir(orgSlug), 'images');
}

export function resolveImagePath(orgSlug: string, filename: string): string {
  if (!validateImageFilename(filename)) {
    throw new Error(`Invalid image filename: ${filename}`);
  }
  return safeJoinWithinDir(resolveImagesDir(orgSlug), filename);
}

/**
 * Public URL for a branding image, segmented by org slug so the static image
 * route (server.ts + serve-branding-images.ts) resolves the right org's
 * bucket: `<SITE_URL><BASE_PATH>/branding/images/<orgSlug>/<filename>`. Returns
 * `null` when there's no filename so callers can pass through "no image".
 */
export function buildBrandingImageUrl(
  orgSlug: string,
  filename: string | undefined,
): string | null {
  if (!filename) return null;
  const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
  const basePath = process.env.BASE_PATH ?? '';
  return `${siteUrl}${basePath}/branding/images/${orgSlug}/${filename}`;
}

export { ALLOWED_IMAGE_EXTENSIONS, MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
