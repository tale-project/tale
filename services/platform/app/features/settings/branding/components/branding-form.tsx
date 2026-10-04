'use client';

import {
  brandingFormSchema,
  type BrandingFormData,
} from '@tale/shared/schemas/branding';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useFormEditor, useRegisterActiveEditor } from '@tale/ui/editor';
import { Form } from '@tale/ui/form';
import { HStack, Stack } from '@tale/ui/layout';
import { useTheme } from '@tale/ui/theme';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller } from 'react-hook-form';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { SettingsFieldList } from '@/app/features/settings/components/settings-field-list';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { useRegisterSettingsSecondaryAction } from '@/app/features/settings/components/settings-secondary-action-context';
import { useT } from '@/lib/i18n/client';
import { backendRefusalReason } from '@/lib/utils/backend-error';
import { adjustColorForTheme, isHexColor } from '@/lib/utils/color';
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

  // What a picked accent is stored as — and so the one color the live app
  // derives each theme's palette from: an untouched field keeps the stored
  // value, a changed dark-mode pick becomes its light-mode equivalent.
  const toStoredAccent = useCallback(
    (picked: string) =>
      picked === displayAccent
        ? storedAccent || picked
        : resolvedTheme === 'dark'
          ? adjustColorForTheme(picked, 'light')
          : picked,
    [displayAccent, resolvedTheme, storedAccent],
  );

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. The favicon/logo uploads below are instant actions and keep their
  // own toasts — they never pass through this save.
  const save = useCallback(
    async (values: BrandingFormData) => {
      try {
        const pickedAccent = values.accentColor || undefined;
        const config = {
          accentColor: pickedAccent && toStoredAccent(pickedAccent),
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
      } catch (err) {
        console.error('[branding] save failed', err);
        throw new Error(tToast('error.brandingUpdateFailed.title'), {
          cause: err,
        });
      }
    },
    [
      organizationId,
      onSaved,
      refetchBranding,
      saveBranding,
      snapshotHistory,
      toStoredAccent,
      tToast,
    ],
  );

  const savedImageFilenamesRef = useRef(
    new Map<
      'logoFilename' | 'faviconLightFilename' | 'faviconDarkFilename',
      string
    >(),
  );

  useEffect(() => {
    savedImageFilenamesRef.current.clear();
  }, [
    branding?.logoFilename,
    branding?.faviconLightFilename,
    branding?.faviconDarkFilename,
  ]);

  const editor = useFormEditor<BrandingFormData>({
    data,
    schema: brandingFormSchema,
    save,
    onReset: () => {
      for (const [filename, value] of savedImageFilenamesRef.current) {
        register(filename);
        resetField(filename, { defaultValue: value });
      }
    },
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
    form: {
      watch,
      setValue,
      getValues,
      control,
      register,
      resetField,
      reset: resetForm,
    },
  } = editor;

  register('logoFilename');
  register('faviconLightFilename');
  register('faviconDarkFilename');

  const watchedValues = watch();

  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [faviconPreviewUrl, setFaviconPreviewUrl] = useState<string | null>(
    null,
  );

  // The accent the preview tints with: the field's value once it is a
  // complete hex, the last complete one while a shorter value is being typed
  // (the preview derives a palette from it, and a partial hex parses to NaN),
  // and nothing once the field is cleared. It is handed over as it would be
  // stored, so the preview derives its shades from the same color the live
  // app does: in dark mode the field shows a dark-rendered value, and
  // deriving from that re-rounds the shades (#443366 would preview a text
  // shade of #9582c0 but paint #9682c0).
  const previewAccentRef = useRef<string | undefined>(undefined);
  const typedAccent = watchedValues.accentColor;
  if (!typedAccent) previewAccentRef.current = undefined;
  else if (isHexColor(typedAccent)) previewAccentRef.current = typedAccent;
  const previewAccent =
    previewAccentRef.current && toStoredAccent(previewAccentRef.current);

  // The app name shown in the preview is the org's name (passed via `branding`)
  // — it is no longer an editable field, so it stays constant as the user edits.
  useEffect(() => {
    onPreviewChange({
      appName: branding?.appName,
      logoUrl: logoPreviewUrl ?? branding?.logoUrl,
      faviconUrl: faviconPreviewUrl ?? branding?.faviconLightUrl,
      accentColor: previewAccent,
    });
  }, [
    branding?.appName,
    previewAccent,
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
        // Already on the server: the image write records its reference, so
        // the field mirrors the saved state rather than staging an edit.
        savedImageFilenamesRef.current.set('faviconLightFilename', filename);
        setValue('faviconLightFilename', filename);
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

  // Reset deletes the uploaded image blobs AND persists the cleared config
  // in the same confirmation — one commit model, not two. It used to stage
  // the accent clear as a pending form edit beside the immediate image
  // deletes, so leaving the page raised the unsaved-changes prompt and a
  // reload still showed the old colour until a further Save (2026-09-26
  // evaluation, E-11). The save rides the normal path, so it writes the
  // one `branding.updated` audit row and adopts the cleared baseline.
  // Distinct from the per-row Discard, which only reverts unsaved edits.
  const [resetting, setResetting] = useState(false);
  const handleClearBranding = useCallback(async () => {
    const cleared: BrandingFormData = {
      accentColor: '',
      logoFilename: '',
      faviconLightFilename: '',
      faviconDarkFilename: '',
    };
    setResetting(true);
    try {
      const deletions = await Promise.allSettled([
        deleteImage.mutateAsync({ organizationId, type: 'logo' }),
        deleteImage.mutateAsync({ organizationId, type: 'favicon-light' }),
        deleteImage.mutateAsync({ organizationId, type: 'favicon-dark' }),
      ]);
      for (const deletion of deletions) {
        if (deletion.status === 'rejected') {
          // Non-fatal: the config save below drops the reference either way;
          // surface the blob-deletion failure rather than swallow it.
          console.warn(
            '[branding] failed to delete an image blob on reset',
            deletion.reason,
          );
        }
      }
      try {
        await save(cleared);
      } catch (err) {
        // The images are gone but the config is not: keep the clear staged
        // so the header's Save can retry it, and say why.
        const opts = { shouldDirty: true };
        setValue('accentColor', '', opts);
        setValue('logoFilename', '', opts);
        setValue('faviconLightFilename', '', opts);
        setValue('faviconDarkFilename', '', opts);
        // `save` wraps the backend failure as its `cause`; the localized
        // title stays the title and the server's own sentence (when it
        // wrote one) goes underneath — never a raw error message as title.
        const cause =
          err instanceof Error && err.cause !== undefined ? err.cause : err;
        toast({
          title: tToast('error.brandingUpdateFailed.title'),
          description: backendRefusalReason(cause),
          variant: 'destructive',
        });
        return;
      }
      // The cleared values ARE the saved state now: nothing left unsaved.
      resetForm(cleared);
      toast({ title: t('branding.resetDone'), variant: 'success' });
    } finally {
      setResetting(false);
    }
  }, [
    deleteImage,
    organizationId,
    resetForm,
    save,
    setValue,
    t,
    tToast,
    toast,
  ]);

  return (
    <Form
      id="branding-form"
      onSubmit={editor.submit}
      className="w-full max-w-sm shrink-0 space-y-0 self-start"
    >
      <Stack gap={0} justify="between" className="h-full">
        {/* One divided list, like every settings section: a hairline between
            Logo, Favicon and Accent color. */}
        <SettingsFieldList>
          <SettingsRow
            className="py-5"
            label={t('branding.logo')}
            description={t('branding.logoDescription')}
          >
            <ImageUploadField
              organizationId={organizationId}
              currentUrl={branding?.logoUrl}
              imageType="logo"
              // Uploads and removals take effect on the server as they
              // happen (the image write records its own reference); the
              // fields only mirror that, so they never dirty the Save cluster.
              onUpload={(filename, file) => {
                savedImageFilenamesRef.current.set('logoFilename', filename);
                setValue('logoFilename', filename);
                void maybeDeriveFavicon(file);
              }}
              onRemove={() => {
                savedImageFilenamesRef.current.set('logoFilename', '');
                resetField('logoFilename', { defaultValue: '' });
              }}
              onPreviewUrlChange={setLogoPreviewUrl}
              size="md"
              ariaLabel={t('branding.uploadLogo')}
            />
          </SettingsRow>

          <SettingsRow
            className="py-5"
            label={t('branding.favicon')}
            description={t('branding.faviconDescription')}
          >
            <HStack gap={2}>
              <ImageUploadField
                organizationId={organizationId}
                currentUrl={faviconPreviewUrl ?? branding?.faviconLightUrl}
                imageType="favicon-light"
                onUpload={(filename) => {
                  savedImageFilenamesRef.current.set(
                    'faviconLightFilename',
                    filename,
                  );
                  setValue('faviconLightFilename', filename);
                }}
                onRemove={() => {
                  savedImageFilenamesRef.current.set(
                    'faviconLightFilename',
                    '',
                  );
                  resetField('faviconLightFilename', { defaultValue: '' });
                }}
                onPreviewUrlChange={setFaviconPreviewUrl}
                label={t('branding.light')}
                ariaLabel={`${t('branding.uploadFavicon')} (${t('branding.light')})`}
              />

              <ImageUploadField
                organizationId={organizationId}
                currentUrl={branding?.faviconDarkUrl}
                imageType="favicon-dark"
                onUpload={(filename) => {
                  savedImageFilenamesRef.current.set(
                    'faviconDarkFilename',
                    filename,
                  );
                  setValue('faviconDarkFilename', filename);
                }}
                onRemove={() => {
                  savedImageFilenamesRef.current.set('faviconDarkFilename', '');
                  resetField('faviconDarkFilename', { defaultValue: '' });
                }}
                label={t('branding.dark')}
                ariaLabel={`${t('branding.uploadFavicon')} (${t('branding.dark')})`}
              />
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
                className="py-5"
                value={field.value ?? ''}
                onChange={field.onChange}
                label={t('branding.accentColor')}
              />
            )}
          />
        </SettingsFieldList>
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
        isLoading={resetting}
        onConfirm={async () => {
          await handleClearBranding();
          setConfirmClearOpen(false);
        }}
      />
    </Form>
  );
}
