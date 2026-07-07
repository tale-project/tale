'use node';

/**
 * Node migration: rewrite each org's `branding.json` from the legacy two-field
 * contract (brandColor + accentColor) to the single accent color that now
 * drives the whole derived palette (#1960).
 *
 * Merge rule: an explicitly-set `accentColor` wins (it was the field with a
 * visible product effect before #2483); otherwise the saved `brandColor` value
 * becomes the `accentColor`. The `brandColor` key is dropped either way.
 *
 * Idempotent per org: a rewritten file has no `brandColor` key, so a re-run is
 * a no-op. `down` restores the pre-migration branding directory from the
 * fs-tree snapshot captured in `up`. A corrupt/unparseable file is logged and
 * left untouched (branding is an enhancement layer; readers already tolerate
 * the legacy key via the schema's read-only `brandColor`).
 */

import {
  parseBrandingJson,
  resolveBrandingDir,
  resolveBrandingFilePath,
  serializeBrandingJson,
} from '../../../../branding/file_utils';
import type { NodeMigration } from '../../../framework/types';
import { meta } from './meta';

export const migration: NodeMigration = {
  meta,
  async up(_ctx, org, helpers) {
    const dir = resolveBrandingDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

    const filePath = resolveBrandingFilePath(org.slug);
    const content = await helpers.readFileSafe(filePath);
    if (!content) return; // org never configured branding

    let config;
    try {
      config = parseBrandingJson(content);
    } catch (err) {
      // Leave a corrupt file for the operator rather than clobbering it — the
      // read path degrades gracefully and the migration stays resumable.
      console.warn(
        `[0.3.4/01] skipping unparseable branding.json for "${org.slug}":`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    if (config.brandColor === undefined) return; // already single-accent

    const { brandColor, ...rest } = config;
    // `''` means "unset" for both hex fields — coalesce on non-empty values.
    const accentColor = config.accentColor || brandColor || undefined;
    await helpers.atomicWrite(
      filePath,
      serializeBrandingJson({ ...rest, accentColor }),
    );
  },

  async down(_ctx, org, helpers) {
    const dir = resolveBrandingDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
  },
};
