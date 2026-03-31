import { z } from 'zod/v4';

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const hexColorSchema = z
  .string()
  .refine((val) => val === '' || HEX_COLOR_REGEX.test(val), 'Invalid hex color')
  .optional();

const imageFilenameSchema = z.string().max(100).optional();

export const brandingJsonSchema = z.object({
  appName: z.string().max(100).optional(),
  textLogo: z.string().max(50).optional(),
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingJsonConfig = z.infer<typeof brandingJsonSchema>;

export const brandingFormSchema = z.object({
  appName: z.string().max(100).optional(),
  textLogo: z.string().max(50).optional(),
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoFilename: imageFilenameSchema,
  faviconLightFilename: imageFilenameSchema,
  faviconDarkFilename: imageFilenameSchema,
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;
