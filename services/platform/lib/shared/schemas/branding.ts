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
export const brandingJsonSchema = z.object({
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingJsonConfig = z.infer<typeof brandingJsonSchema>;

export const brandingFormSchema = z.object({
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;
