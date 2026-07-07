import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.3.4 / 01 — merge the legacy `brandColor` into the single `accentColor`
 * (#1960: the whole branded palette is now derived from one accent color).
 *
 * For each org with a `branding.json`, rewrites the file dropping `brandColor`:
 * an explicitly-set `accentColor` is kept (it was the field with a visible
 * product effect pre-#2483); otherwise the saved `brandColor` becomes the
 * `accentColor`, so no configured color silently disappears. Orgs without a
 * branding file (or without a `brandColor` key) are untouched. A per-org
 * fs-tree snapshot of the branding directory is taken first so `down` restores
 * the prior two-field files byte-for-byte. Idempotent (re-running finds no
 * `brandColor` key and is a no-op).
 */
export const meta: MigrationMeta = {
  id: '0.3.4/01_branding_single_accent_color',
  semver: '0.3.4',
  numericId: 1,
  slug: 'branding_single_accent_color',
  title: 'Merge branding brandColor into the single accentColor',
  description:
    'For each org with a branding.json, drops the legacy brandColor field: ' +
    'a set accentColor is kept, otherwise the brandColor value becomes the ' +
    'accentColor (no configured color is lost). A per-org fs-tree snapshot ' +
    'of <org>/branding/ is taken first so down restores the prior files.',
  kind: 'node',
  reversible: true,
  destructive: true,
  snapshot: 'fs-tree',
};
