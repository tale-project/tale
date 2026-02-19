'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';

import type { Id } from '@/convex/_generated/dataModel';

import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  brandingFormSchema,
  type BrandingFormData,
} from '@/lib/shared/schemas/branding';

import type { BrandingPreviewData } from './branding-preview';

import { useUpsertBranding } from '../hooks/mutations';
import { ColorPickerInput } from './color-picker-input';
import { ImageUploadField } from './image-upload-field';

interface BrandingData {
  appName?: string;
  textLogo?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
  brandColor?: string;
  accentColor?: string;
}

interface BrandingFormProps {
  organizationId: string;
  branding?: BrandingData;
  onPreviewChange: (data: BrandingPreviewData) => void;
}

export function BrandingForm({
  organizationId,
  branding,
  onPreviewChange,
}: BrandingFormProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { toast } = useToast();
  const upsertBranding = useUpsertBranding();

  const schema = useMemo(() => brandingFormSchema, []);

  const form = useForm<BrandingFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      appName: branding?.appName ?? '',
      textLogo: branding?.textLogo ?? '',
      brandColor: branding?.brandColor ?? '',
      accentColor: branding?.accentColor ?? '',
    },
  });

  const { formState, handleSubmit, register, watch, setValue } = form;
  const { isDirty, isSubmitting } = formState;

  const watchedValues = watch();

  const logoStorageIdRef = useRef<Id<'_storage'> | undefined>(undefined);
  const faviconLightStorageIdRef = useRef<Id<'_storage'> | undefined>(
    undefined,
  );
  const faviconDarkStorageIdRef = useRef<Id<'_storage'> | undefined>(undefined);
  const logoPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    onPreviewChange({
      appName: watchedValues.appName || undefined,
      textLogo: watchedValues.textLogo || undefined,
      logoUrl: logoPreviewUrlRef.current ?? branding?.logoUrl,
      brandColor: watchedValues.brandColor || undefined,
      accentColor: watchedValues.accentColor || undefined,
    });
  }, [
    watchedValues.appName,
    watchedValues.textLogo,
    watchedValues.brandColor,
    watchedValues.accentColor,
    branding?.logoUrl,
    onPreviewChange,
  ]);

  const onSubmit = useCallback(
    async (data: BrandingFormData) => {
      try {
        await upsertBranding.mutateAsync({
          organizationId,
          appName: data.appName || undefined,
          textLogo: data.textLogo || undefined,
          brandColor: data.brandColor || undefined,
          accentColor: data.accentColor || undefined,
          logoStorageId: logoStorageIdRef.current,
          faviconLightStorageId: faviconLightStorageIdRef.current,
          faviconDarkStorageId: faviconDarkStorageIdRef.current,
        });

        form.reset(data);

        toast({
          title: tToast('success.brandingUpdated'),
          variant: 'success',
        });
      } catch {
        toast({
          title: tToast('error.brandingUpdateFailed'),
          variant: 'destructive',
        });
      }
    },
    [organizationId, upsertBranding, form, toast, tToast],
  );

  const handleBrandColorChange = useCallback(
    (value: string) => {
      setValue('brandColor', value, { shouldDirty: true });
    },
    [setValue],
  );

  const handleAccentColorChange = useCallback(
    (value: string) => {
      setValue('accentColor', value, { shouldDirty: true });
    },
    [setValue],
  );

  return (
    <Form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full max-w-sm shrink-0 space-y-0"
    >
      <div className="flex h-full flex-col justify-between">
        <Stack gap={6}>
          <Input
            id="branding-app-name"
            label={t('branding.appName')}
            placeholder={t('branding.appNamePlaceholder')}
            {...register('appName')}
            wrapperClassName="w-full"
          />

          <div className="flex flex-col gap-2">
            <label
              htmlFor="branding-text-logo"
              className="text-foreground text-sm leading-5 font-medium"
            >
              {t('branding.textLogo')}{' '}
              <span className="text-muted-foreground text-xs font-normal">
                {t('branding.textLogoOptional')}
              </span>
            </label>
            <Input
              id="branding-text-logo"
              placeholder={t('branding.textLogoPlaceholder')}
              {...register('textLogo')}
              wrapperClassName="w-full"
            />
          </div>

          <HStack justify="between" align="center">
            <div className="flex flex-col gap-1">
              <span className="text-foreground text-sm leading-6 font-medium tracking-tight">
                {t('branding.logo')}
              </span>
              <span className="text-muted-foreground text-xs tracking-tight">
                {t('branding.logoDescription')}
              </span>
            </div>
            <ImageUploadField
              currentUrl={branding?.logoUrl}
              onUpload={(storageId) => {
                logoStorageIdRef.current = storageId;
              }}
              onRemove={() => {
                logoStorageIdRef.current = undefined;
              }}
              size="md"
              ariaLabel={t('branding.uploadLogo')}
            />
          </HStack>

          <HStack justify="between" align="center">
            <div className="flex flex-col gap-1">
              <span className="text-foreground text-sm leading-6 font-medium tracking-tight">
                {t('branding.favicon')}
              </span>
              <span className="text-muted-foreground text-xs tracking-tight">
                {t('branding.faviconDescription')}
              </span>
            </div>
            <HStack gap={2}>
              <ImageUploadField
                currentUrl={branding?.faviconLightUrl}
                onUpload={(storageId) => {
                  faviconLightStorageIdRef.current = storageId;
                }}
                onRemove={() => {
                  faviconLightStorageIdRef.current = undefined;
                }}
                label={t('branding.light')}
                ariaLabel={`${t('branding.uploadFavicon')} (${t('branding.light')})`}
              />
              <ImageUploadField
                currentUrl={branding?.faviconDarkUrl}
                onUpload={(storageId) => {
                  faviconDarkStorageIdRef.current = storageId;
                }}
                onRemove={() => {
                  faviconDarkStorageIdRef.current = undefined;
                }}
                label={t('branding.dark')}
                ariaLabel={`${t('branding.uploadFavicon')} (${t('branding.dark')})`}
              />
            </HStack>
          </HStack>

          <ColorPickerInput
            id="branding-brand-color"
            value={watchedValues.brandColor || '#000000'}
            onChange={handleBrandColorChange}
            label={t('branding.brandColor')}
          />

          <ColorPickerInput
            id="branding-accent-color"
            value={watchedValues.accentColor || '#000000'}
            onChange={handleAccentColorChange}
            label={t('branding.accentColor')}
          />
        </Stack>

        <div className="ml-auto pt-6">
          <Button
            type="submit"
            disabled={!isDirty || isSubmitting}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </div>
      </div>
    </Form>
  );
}
