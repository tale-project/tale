import { z } from 'zod/v4';

export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const hexColorSchema = z.string().regex(HEX_COLOR_REGEX).optional();

export const brandingFormSchema = z.object({
  appName: z.string().max(100).optional(),
  textLogo: z.string().max(50).optional(),
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;
