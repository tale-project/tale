import { z } from 'zod/v4';

const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .optional();

export const brandingFormSchema = z.object({
  appName: z.string().max(100).optional(),
  textLogo: z.string().max(50).optional(),
  brandColor: hexColorSchema,
  accentColor: hexColorSchema,
});
export type BrandingFormData = z.infer<typeof brandingFormSchema>;

export const brandingSettingsSchema = brandingFormSchema.extend({
  organizationId: z.string(),
  logoStorageId: z.string().optional(),
  faviconLightStorageId: z.string().optional(),
  faviconDarkStorageId: z.string().optional(),
});
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;

export const brandingWithUrlsSchema = brandingFormSchema.extend({
  logoUrl: z.string().nullable().optional(),
  faviconLightUrl: z.string().nullable().optional(),
  faviconDarkUrl: z.string().nullable().optional(),
});
export type BrandingWithUrls = z.infer<typeof brandingWithUrlsSchema>;
