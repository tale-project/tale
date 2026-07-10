'use node';

/**
 * 0.3.4 / 21 — merge the legacy `brandColor` into the single `accentColor`
 * (#1960: the whole branded palette is now derived from one accent color).
 *
 * For each org with a `branding.json`, rewrites the file dropping `brandColor`:
 * an explicitly-set `accentColor` wins (it was the field with a visible
 * product effect before #2483); otherwise the saved `brandColor` value becomes
 * the `accentColor`, so no configured color silently disappears. Orgs without
 * a branding file (or without a `brandColor` key) are untouched.
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
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Merge branding brandColor into the single accentColor',
  description:
    'For each org with a branding.json, drops the legacy brandColor field: ' +
    'a set accentColor is kept, otherwise the brandColor value becomes the ' +
    'accentColor (no configured color is lost). A per-org fs-tree snapshot ' +
    'of <org>/branding/ is taken first so down restores the prior files.',
  destructive: true,
  snapshot: 'fs-tree',
  formerIds: ['0.3.4/01_branding_single_accent_color'],
  subjects: { domains: ['branding'] },

  async up(_ctx, org, helpers) {
    const dir = resolveBrandingDir(org.slug);
    await helpers.snapshotFsTree(dir);

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
        `[0.3.4/21] skipping unparseable branding.json for "${org.slug}":`,
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
    await helpers.restoreFsTree(dir);
  },
});
