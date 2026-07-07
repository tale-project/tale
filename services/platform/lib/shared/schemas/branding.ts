import { z } from 'zod/v4';

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const hexColorSchema = z
  .string()
  .refine((val) => val === '' || HEX_COLOR_REGEX.test(val), 'Invalid hex color')
  .optional();

const imageFilenameSchema = z.string().max(100).optional();

// The display name shown as the "app name" is the organization's own name,
// resolved server-side on read — it is not a stored branding field. Likewise
// the wordmark falls back to the org name, so there is no `textLogo`. Both were
// dropped; legacy `branding.json` files that still carry them are tolerated
// because `z.object` strips unknown keys.
//
// `brandColor` is a READ-ONLY legacy field (#1960): the single `accentColor`
// now drives the whole derived palette. It stays in the JSON schema so
// unmigrated files still surface their saved color (readers coalesce
// `accentColor || brandColor`); the 0.3.4/01 node migration merges it into
// `accentColor` on disk, and saves never write it (it's absent from the form
// schema and the save action's args).
export const brandingJsonSchema = z.object({
  /** @deprecated Legacy pre-#1960 field — read-only; merged into `accentColor`. */
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingJsonConfig = z.infer<typeof brandingJsonSchema>;

export const brandingFormSchema = z.object({
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;
