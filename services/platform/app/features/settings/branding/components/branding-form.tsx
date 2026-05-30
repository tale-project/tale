'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  brandingFormSchema,
  type BrandingFormData,
} from '@/lib/shared/schemas/branding';

import {
  useDeleteImage,
  useSaveBranding,
  useSnapshotBrandingHistory,
} from '../hooks/mutations';
import type { BrandingPreviewData } from './branding-preview';
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

/**
 * Masks a non-skeleton-aware control (color picker / image upload) to its
 * exact footprint while a parent `<Skeletonize>` is loading. Outside any
 * `<Skeletonize>` (e.g. the form's own unit tests) `useSkeleton()` is `false`,
 * so the real control renders unchanged.
 */
function MaskWhileLoading({ children }: { children: ReactNode }) {
  const loading = useSkeleton();
  if (loading) {
    return <SkeletonBox>{children}</SkeletonBox>;
  }
  return <>{children}</>;
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

  const data = useMemo<BrandingFormData>(
    () => ({
      appName: branding?.appName ?? '',
      textLogo: branding?.textLogo ?? '',
      brandColor: branding?.brandColor ?? '',
      accentColor: branding?.accentColor ?? '',
      logoFilename: branding?.logoFilename ?? '',
      faviconLightFilename: branding?.faviconLightFilename ?? '',
      faviconDarkFilename: branding?.faviconDarkFilename ?? '',
    }),
    [branding],
  );

  const save = useCallback(
    async (values: BrandingFormData) => {
      try {
        const config = {
          appName: values.appName || undefined,
          textLogo: values.textLogo || undefined,
          brandColor: values.brandColor || undefined,
          accentColor: values.accentColor || undefined,
          logoFilename: values.logoFilename || undefined,
          faviconLightFilename: values.faviconLightFilename || undefined,
          faviconDarkFilename: values.faviconDarkFilename || undefined,
        };
        // Snapshot the prior baseline AFTER save succeeds (fix to inherited
        // snapshot-then-save bug). Best-effort; failure is non-fatal.
        await saveBranding.mutateAsync({ config });
        snapshotHistory
          .mutateAsync({})
          .catch((e) => console.warn('[branding history snapshot]', e));
        onSaved?.();
        void refetchBranding();
        toast({
          title: tToast('success.brandingUpdated'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: tToast('error.brandingUpdateFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [onSaved, refetchBranding, saveBranding, snapshotHistory, toast, tToast],
  );

  const editor = useFormEditor<BrandingFormData>({
    data,
    schema: brandingFormSchema,
    save,
  });

  useRegisterActiveEditor(editor);

  const {
    form: { handleSubmit, register, watch, setValue, formState },
  } = editor;

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

  // Clear branding wipes the form fields AND deletes the uploaded image
  // blobs. Distinct from the per-row Discard which only reverts unsaved
  // edits — clearing is a destructive, server-mutating action.
  const handleClearBranding = useCallback(async () => {
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
      id="branding-form"
      onSubmit={handleSubmit((values) => save(values))}
      className="w-full max-w-sm shrink-0 space-y-0"
    >
      <div className="flex h-full flex-col justify-between">
        <FormSection>
          <Input
            id="branding-app-name"
            label={t('branding.appName')}
            placeholder={t('branding.appNamePlaceholder')}
            required
            errorMessage={
              formState.errors.appName
                ? t('branding.validation.appNameRequired')
                : undefined
            }
            {...register('appName')}
            wrapperClassName="w-full"
          />

          <Input
            id="branding-text-logo"
            label={`${t('branding.textLogo')} ${t('branding.textLogoOptional')}`}
            placeholder={t('branding.textLogoPlaceholder')}
            {...register('textLogo')}
            wrapperClassName="w-full"
          />

          <SettingsRow
            label={t('branding.logo')}
            description={t('branding.logoDescription')}
          >
            <MaskWhileLoading>
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
            </MaskWhileLoading>
          </SettingsRow>

          <SettingsRow
            label={t('branding.favicon')}
            description={t('branding.faviconDescription')}
          >
            <HStack gap={2}>
              <MaskWhileLoading>
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
              </MaskWhileLoading>
              <MaskWhileLoading>
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
              </MaskWhileLoading>
            </HStack>
          </SettingsRow>

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

        {hasAnyBranding && (
          <HStack justify="start" className="mt-4">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleClearBranding()}
            >
              {tCommon('actions.clearAll')}
            </Button>
          </HStack>
        )}
      </div>
    </Form>
  );
}
