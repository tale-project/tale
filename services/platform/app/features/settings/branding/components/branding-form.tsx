'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { useTheme } from '@tale/ui/theme';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Controller } from 'react-hook-form';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { useRegisterSettingsSecondaryAction } from '@/app/features/settings/components/settings-secondary-action-context';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  brandingFormSchema,
  type BrandingFormData,
} from '@/lib/shared/schemas/branding';
import { adjustColorForTheme } from '@/lib/utils/color';
import {
  deriveFaviconPngBase64,
  shouldDeriveFavicon,
} from '@/lib/utils/image/derive-favicon';

import {
  useDeleteImage,
  useSaveBranding,
  useSaveImage,
  useSnapshotBrandingHistory,
} from '../hooks/mutations';
import type { BrandingPreviewData } from './branding-preview';
import { ColorPickerInput } from './color-picker-input';
import { ImageUploadField } from './image-upload-field';

interface BrandingData {
  appName?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
  accentColor?: string;
  logoFilename?: string;
  faviconLightFilename?: string;
  faviconDarkFilename?: string;
}

interface BrandingFormProps {
  organizationId: string;
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
  organizationId,
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
  const saveImage = useSaveImage();
  const { resolvedTheme } = useTheme();

  // The stored accent is ALWAYS the light-mode color; dark mode derives its
  // variant at render time. The picker therefore works in the CURRENT
  // theme's terms: in dark mode the field shows (and the user picks) the
  // dark-rendered color, and a changed pick is converted back to its
  // light-mode equivalent before storing. An untouched field round-trips the
  // stored value verbatim — the lightness walk is lossy, so converting an
  // unchanged display value would drift the stored color on every save.
  const storedAccent = branding?.accentColor ?? '';
  const displayAccent = useMemo(() => {
    if (!storedAccent) return '';
    return resolvedTheme === 'dark'
      ? adjustColorForTheme(storedAccent, 'dark')
      : storedAccent;
  }, [storedAccent, resolvedTheme]);

  const data = useMemo<BrandingFormData>(
    () => ({
      accentColor: displayAccent,
      logoFilename: branding?.logoFilename ?? '',
      faviconLightFilename: branding?.faviconLightFilename ?? '',
      faviconDarkFilename: branding?.faviconDarkFilename ?? '',
    }),
    [branding, displayAccent],
  );

  const save = useCallback(
    async (values: BrandingFormData) => {
      try {
        const pickedAccent = values.accentColor || undefined;
        const accentToStore =
          pickedAccent === undefined
            ? undefined
            : pickedAccent === displayAccent
              ? storedAccent || pickedAccent
              : resolvedTheme === 'dark'
                ? adjustColorForTheme(pickedAccent, 'light')
                : pickedAccent;
        const config = {
          accentColor: accentToStore,
          logoFilename: values.logoFilename || undefined,
          faviconLightFilename: values.faviconLightFilename || undefined,
          faviconDarkFilename: values.faviconDarkFilename || undefined,
        };
        // Snapshot the prior baseline AFTER save succeeds (fix to inherited
        // snapshot-then-save bug). Best-effort; failure is non-fatal.
        await saveBranding.mutateAsync({ organizationId, config });
        snapshotHistory
          .mutateAsync({ organizationId })
          .catch((e) => console.warn('[branding history snapshot]', e));
        onSaved?.();
        void refetchBranding();
        toast({
          title: tToast('success.brandingUpdated.title'),
          description: tToast('success.brandingUpdated.description'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: tToast('error.brandingUpdateFailed.title'),
          description: tToast('error.brandingUpdateFailed.description'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [
      displayAccent,
      organizationId,
      onSaved,
      refetchBranding,
      resolvedTheme,
      saveBranding,
      snapshotHistory,
      storedAccent,
      toast,
      tToast,
    ],
  );

  const editor = useFormEditor<BrandingFormData>({
    data,
    schema: brandingFormSchema,
    save,
  });

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const hasAnyBranding =
    !!branding?.accentColor ||
    !!branding?.logoUrl ||
    !!branding?.faviconLightUrl ||
    !!branding?.faviconDarkUrl;

  useRegisterActiveEditor(editor);

  // Reset lives in the settings header next to Save/Discard (the shared
  // top-bar slot) rather than as a local button at the form's foot — to the
  // LEFT of Discard, so Save stays the rightmost button. The action count
  // must stay stable across renders, so it registers always and disables
  // when there is nothing to reset.
  useRegisterSettingsSecondaryAction([
    {
      label: tCommon('actions.reset'),
      variant: 'secondary',
      placement: 'leading',
      disabled: !hasAnyBranding,
      onClick: () => setConfirmClearOpen(true),
    },
  ]);

  const {
    form: { watch, setValue, getValues, control },
  } = editor;

  const watchedValues = watch();

  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null,
  );

  // The app name shown in the preview is the org's name (passed via `branding`)
  // — it is no longer an editable field, so it stays constant as the user edits.
  useEffect(() => {
    onPreviewChange({
      appName: branding?.appName,
      logoUrl: logoPreviewUrl ?? branding?.logoUrl,
      faviconUrl: faviconPreviewUrl ?? branding?.faviconLightUrl,
      accentColor: watchedValues.accentColor || undefined,
    });
  }, [
    branding?.appName,
    watchedValues.accentColor,
    branding?.logoUrl,
    branding?.faviconLightUrl,
    logoPreviewUrl,
    faviconPreviewUrl,
    onPreviewChange,
  ]);

  // When a logo is uploaded and no favicon is set yet, derive a square favicon
  // from the same image so the org gets a tab icon without a second upload.
  const maybeDeriveFavicon = useCallback(
    async (file: File) => {
      const values = getValues();
      const faviconState = {
        faviconLightFilename: values.faviconLightFilename || undefined,
        faviconDarkFilename: values.faviconDarkFilename || undefined,
        faviconLightUrl: branding?.faviconLightUrl,
        faviconDarkUrl: branding?.faviconDarkUrl,
      };
      if (!shouldDeriveFavicon(faviconState)) return;

      try {
        const base64 = await deriveFaviconPngBase64(file);
        const { filename } = await saveImage.mutateAsync({
          organizationId,
          type: 'favicon-light',
          base64,
          mimeType: 'image/png',
        });
        setValue('faviconLightFilename', filename, { shouldDirty: true });
        setFaviconPreviewUrl(`data:image/png;base64,${base64}`);
        toast({
          title: tToast('success.faviconGenerated.title'),
          description: tToast('success.faviconGenerated.description'),
          variant: 'success',
        });
      } catch (err) {
        // Non-fatal: the logo still uploaded; the admin can set a favicon
        // manually. Surface rather than swallow so canvas/upload bugs show up.
        console.warn('[branding] favicon derivation from logo failed', err);
      }
    },
    [
      getValues,
      setValue,
      branding?.faviconLightUrl,
      branding?.faviconDarkUrl,
      organizationId,
      saveImage,
      toast,
      tToast,
    ],
  );

  // Clear branding wipes the form fields AND deletes the uploaded image
  // blobs. Distinct from the per-row Discard which only reverts unsaved
  // edits — clearing is a destructive, server-mutating action.
  const handleClearBranding = useCallback(async () => {
    const opts = { shouldDirty: true };
    setValue('accentColor', '', opts);
    setValue('logoFilename', '', opts);
    setValue('faviconLightFilename', '', opts);
    setValue('faviconDarkFilename', '', opts);

    await Promise.all([
      deleteImage.mutateAsync({ organizationId, type: 'logo' }),
      deleteImage.mutateAsync({ organizationId, type: 'favicon-light' }),
      deleteImage.mutateAsync({ organizationId, type: 'favicon-dark' }),
    ]).catch((err) => {
      // Non-fatal: the form fields are already cleared and will be persisted on
      // the next save; surface the blob-deletion failure rather than swallow it.
      console.warn('[branding] failed to delete image blobs on clear', err);
    });
  }, [organizationId, setValue, deleteImage]);

  return (
    <Form
      id="branding-form"
      onSubmit={editor.submit}
      className="w-full max-w-sm shrink-0 space-y-0 self-start"
    >
      <Stack gap={0} justify="between" className="h-full">
        <FormSection className="gap-6">
          <SettingsRow
            label={t('branding.logo')}
            description={t('branding.logoDescription')}
          >
            <MaskWhileLoading>
              <ImageUploadField
                organizationId={organizationId}
                currentUrl={branding?.logoUrl}
                imageType="logo"
                onUpload={(filename, file) => {
                  setValue('logoFilename', filename, { shouldDirty: true });
                  void maybeDeriveFavicon(file);
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
                  organizationId={organizationId}
                  currentUrl={faviconPreviewUrl ?? branding?.faviconLightUrl}
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
                  organizationId={organizationId}
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

          {/* Controlled via RHF `Controller` so dirty tracking is automatic —
              the field registers itself and `field.onChange` marks it dirty,
              so there's no `setValue(..., { shouldDirty })` to forget. The one
              accent color drives the whole derived palette (#1960). */}
          <Controller
            control={control}
            name="accentColor"
            render={({ field }) => (
              <ColorPickerInput
                id="branding-accent-color"
                value={field.value ?? ''}
                onChange={field.onChange}
                label={t('branding.accentColor')}
              />
            )}
          />
        </FormSection>
      </Stack>

      {/* Clearing is destructive (deletes the uploaded logo + favicon blobs
          server-side), so it confirms first like every other destructive
          settings action. */}
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        variant="destructive"
        title={t('branding.resetConfirmTitle')}
        description={t('branding.resetConfirmDescription')}
        confirmText={tCommon('actions.reset')}
        onConfirm={async () => {
          await handleClearBranding();
          setConfirmClearOpen(false);
        }}
      />
    </Form>
  );
}
