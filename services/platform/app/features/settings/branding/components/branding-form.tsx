'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  brandingFormSchema,
  type BrandingFormData,
} from '@/lib/shared/schemas/branding';

import type { BrandingPreviewData } from './branding-preview';

import {
  useDeleteImage,
  useSaveBranding,
  useSnapshotBrandingHistory,
} from '../hooks/mutations';
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
  logoFilename?: string;
  faviconLightFilename?: string;
  faviconDarkFilename?: string;
}

interface BrandingFormProps {
  branding?: BrandingData;
  onPreviewChange: (data: BrandingPreviewData) => void;
  onSaved?: () => void;
}

export function BrandingForm({
  branding,
  onPreviewChange,
  onSaved,
}: BrandingFormProps) {
  const { refetch: refetchBranding } = useBrandingContext();
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { toast } = useToast();
  const saveBranding = useSaveBranding();
  const snapshotHistory = useSnapshotBrandingHistory();
  const deleteImage = useDeleteImage();

  const form = useForm<BrandingFormData>({
    resolver: zodResolver(brandingFormSchema),
    defaultValues: {
      appName: branding?.appName ?? '',
      textLogo: branding?.textLogo ?? '',
      brandColor: branding?.brandColor ?? '',
      accentColor: branding?.accentColor ?? '',
      logoFilename: branding?.logoFilename ?? '',
      faviconLightFilename: branding?.faviconLightFilename ?? '',
      faviconDarkFilename: branding?.faviconDarkFilename ?? '',
    },
  });

  const { formState, handleSubmit, register, watch, setValue } = form;
  const { isSubmitting, isDirty } = formState;

  const watchedValues = watch();

  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null,
  );

  useEffect(() => {
    onPreviewChange({
      appName: watchedValues.appName || undefined,
      textLogo: watchedValues.textLogo || undefined,
      logoUrl: logoPreviewUrl ?? branding?.logoUrl,
      faviconUrl: faviconPreviewUrl ?? branding?.faviconLightUrl,
      brandColor: watchedValues.brandColor || undefined,
      accentColor: watchedValues.accentColor || undefined,
    });
  }, [
    watchedValues.appName,
    watchedValues.textLogo,
    watchedValues.brandColor,
    watchedValues.accentColor,
    branding?.logoUrl,
    branding?.faviconLightUrl,
    logoPreviewUrl,
    faviconPreviewUrl,
    onPreviewChange,
  ]);

  const onSubmit = useCallback(
    async (data: BrandingFormData) => {
      try {
        await snapshotHistory.mutateAsync({});

        await saveBranding.mutateAsync({
          config: {
            appName: data.appName || undefined,
            textLogo: data.textLogo || undefined,
            brandColor: data.brandColor || undefined,
            accentColor: data.accentColor || undefined,
            logoFilename: data.logoFilename || undefined,
            faviconLightFilename: data.faviconLightFilename || undefined,
            faviconDarkFilename: data.faviconDarkFilename || undefined,
          },
        });

        form.reset(data);
        onSaved?.();
        void refetchBranding();

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
    [
      saveBranding,
      snapshotHistory,
      form,
      toast,
      tToast,
      onSaved,
      refetchBranding,
    ],
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

  const handleReset = useCallback(async () => {
    const opts = { shouldDirty: true };
    setValue('appName', '', opts);
    setValue('textLogo', '', opts);
    setValue('brandColor', '', opts);
    setValue('accentColor', '', opts);
    setValue('logoFilename', '', opts);
    setValue('faviconLightFilename', '', opts);
    setValue('faviconDarkFilename', '', opts);

    await Promise.all([
      deleteImage.mutateAsync({ type: 'logo' }),
      deleteImage.mutateAsync({ type: 'favicon-light' }),
      deleteImage.mutateAsync({ type: 'favicon-dark' }),
    ]).catch(() => {});
  }, [setValue, deleteImage]);

  const hasAnyBranding =
    !!branding?.appName ||
    !!branding?.textLogo ||
    !!branding?.brandColor ||
    !!branding?.accentColor ||
    !!branding?.logoUrl ||
    !!branding?.faviconLightUrl ||
    !!branding?.faviconDarkUrl;

  return (
    <Form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full max-w-sm shrink-0 space-y-0"
    >
      <div className="flex h-full flex-col justify-between">
        <FormSection>
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
              <Text as="span" variant="caption" className="font-normal">
                {t('branding.textLogoOptional')}
              </Text>
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
              <Text
                as="span"
                variant="label"
                className="leading-6 tracking-tight"
              >
                {t('branding.logo')}
              </Text>
              <Text as="span" variant="caption" className="tracking-tight">
                {t('branding.logoDescription')}
              </Text>
            </div>
            <ImageUploadField
              currentUrl={branding?.logoUrl}
              imageType="logo"
              onUpload={(filename) => {
                setValue('logoFilename', filename, { shouldDirty: true });
              }}
              onRemove={() => {
                setValue('logoFilename', '', { shouldDirty: true });
              }}
              onPreviewUrlChange={setLogoPreviewUrl}
              size="md"
              ariaLabel={t('branding.uploadLogo')}
            />
          </HStack>

          <HStack justify="between" align="center">
            <div className="flex flex-col gap-1">
              <Text
                as="span"
                variant="label"
                className="leading-6 tracking-tight"
              >
                {t('branding.favicon')}
              </Text>
              <Text as="span" variant="caption" className="tracking-tight">
                {t('branding.faviconDescription')}
              </Text>
            </div>
            <HStack gap={2}>
              <ImageUploadField
                currentUrl={branding?.faviconLightUrl}
                imageType="favicon-light"
                onUpload={(filename) => {
                  setValue('faviconLightFilename', filename, {
                    shouldDirty: true,
                  });
                }}
                onRemove={() => {
                  setValue('faviconLightFilename', '', {
                    shouldDirty: true,
                  });
                }}
                onPreviewUrlChange={setFaviconPreviewUrl}
                label={t('branding.light')}
                ariaLabel={`${t('branding.uploadFavicon')} (${t('branding.light')})`}
              />
              <ImageUploadField
                currentUrl={branding?.faviconDarkUrl}
                imageType="favicon-dark"
                onUpload={(filename) => {
                  setValue('faviconDarkFilename', filename, {
                    shouldDirty: true,
                  });
                }}
                onRemove={() => {
                  setValue('faviconDarkFilename', '', {
                    shouldDirty: true,
                  });
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
        </FormSection>

        <HStack justify="between" className="pt-6">
          {hasAnyBranding && (
            <Button type="button" variant="secondary" onClick={handleReset}>
              {tCommon('actions.reset')}
            </Button>
          )}
          <div className="ml-auto">
            <Button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="bg-foreground text-background hover:bg-foreground/90"
            >
              {isSubmitting
                ? tCommon('actions.saving')
                : tCommon('actions.saveChanges')}
            </Button>
          </div>
        </HStack>
      </div>
    </Form>
  );
}
