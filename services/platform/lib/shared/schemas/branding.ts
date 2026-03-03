import { z } from 'zod/v4';

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/;

const hexColorSchema = z
  .string()
  .refine((val) => val === '' || HEX_COLOR_REGEX.test(val), 'Invalid hex color')
  .optional();

export const brandingFormSchema = z.object({
  appName: z.string().max(100).optional(),
  textLogo: z.string().max(50).optional(),
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
  logoStorageId: z.string().optional(),
  faviconLightStorageId: z.string().optional(),
  faviconDarkStorageId: z.string().optional(),
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;
