'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import {
  useGenerateAutomationUploadUrl,
  useRecordAutomationUploadIntent,
  useUploadAutomationBundle,
} from '@/app/features/automations/hooks/upload-mutations';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { fetchJson } from '@/lib/utils/type-utils';

import { useUploadAutomation } from './hooks/use-upload-automation';
import { PreviewStep } from './steps/preview-step';
import { UploadStep } from './steps/upload-step';

interface AutomationUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Called with the slug once the upload has landed on disk. */
  onUploaded?: (slug: string) => void;
}

export function AutomationUploadDialog({
  open,
  onOpenChange,
  organizationId,
  onUploaded,
}: AutomationUploadDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');

  const { mutateAsync: generateUploadUrl } = useGenerateAutomationUploadUrl();
  const { mutateAsync: recordIntent } = useRecordAutomationUploadIntent();
  const { mutateAsync: uploadFn } = useUploadAutomationBundle();

  const state = useUploadAutomation();
  const [confirmReplaceSlug, setConfirmReplaceSlug] = useState<string | null>(
    null,
  );

  // Abort the in-flight blob POST when the dialog closes/unmounts so we don't
  // strand `_storage` writes the user explicitly cancelled.
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        abortRef.current?.abort();
        abortRef.current = null;
        state.reset();
        setConfirmReplaceSlug(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, state],
  );

  // Run the upload (presign → POST → record intent → action). Returns true when
  // the bundle landed, false when the server needs explicit replace confirm.
  const runUpload = useCallback(
    async (force: boolean): Promise<boolean> => {
      const bundle = state.parsedBundle;
      if (!bundle) return false;

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const uploadUrl = await generateUploadUrl({ organizationId });
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: bundle.zipFile,
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new Error(`Upload failed (HTTP ${resp.status})`);
      }
      const { storageId: rawStorageId } = await fetchJson<{
        storageId: string;
      }>(resp);
      const storageId = toId<'_storage'>(rawStorageId);

      // Bind the blob to (org, user) BEFORE invoking the action — the action
      // refuses any storageId that lacks an intent row (`STORAGE_NOT_OWNED`).
      await recordIntent({ organizationId, storageId });

      const result = await uploadFn({
        organizationId,
        storageId,
        ...(force ? { force: true } : {}),
      });

      if (!result.ok) {
        if (isMountedRef.current) setConfirmReplaceSlug(result.slug);
        return false;
      }
      return true;
    },
    [
      state.parsedBundle,
      generateUploadUrl,
      recordIntent,
      uploadFn,
      organizationId,
    ],
  );

  const submit = useCallback(
    async (force: boolean) => {
      if (!state.parsedBundle || state.isSubmitting) return;
      state.setIsSubmitting(true);
      try {
        const landed = await runUpload(force);
        if (force && isMountedRef.current) setConfirmReplaceSlug(null);
        if (landed) {
          const slug = state.parsedBundle.slug;
          toast({
            title: force
              ? t('upload.replaceSuccess', {
                  defaultValue: 'Automation replaced',
                })
              : t('upload.uploadSuccess', {
                  defaultValue: 'Automation uploaded',
                }),
            description: t('upload.installHint', {
              defaultValue:
                'Install it from the Automations list when you’re ready.',
            }),
            variant: 'success',
          });
          handleOpenChange(false);
          onUploaded?.(slug);
        }
        // landed=false (and !force) → confirm dialog picks it up; keep open.
      } catch (err) {
        if (isAbortError(err)) return;
        toast({
          title: t('upload.uploadFailed', {
            defaultValue: 'Failed to upload automation',
          }),
          description: extractErrorMessage(err),
          variant: 'destructive',
        });
      } finally {
        if (isMountedRef.current) state.setIsSubmitting(false);
      }
    },
    [state, runUpload, t, handleOpenChange, onUploaded],
  );

  const footer = (
    <>
      {state.step === 'upload' ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleOpenChange(false)}
        >
          {tCommon('actions.cancel')}
        </Button>
      ) : (
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={state.goBack}
            disabled={state.isSubmitting}
          >
            {tCommon('actions.back')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false)}
            disabled={!state.parsedBundle || state.isSubmitting}
          >
            {state.isSubmitting
              ? t('upload.submitting', { defaultValue: 'Uploading…' })
              : t('upload.submit', { defaultValue: 'Upload package' })}
          </Button>
        </>
      )}
    </>
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('upload.dialogTitle', {
          defaultValue: 'Upload automation package',
        })}
        size="xl"
        footer={footer}
        className="max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden"
      >
        <Stack className="min-h-0 min-w-0 overflow-hidden">
          {state.step === 'upload' ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
              <UploadStep onBundleParsed={state.setParsedBundle} />
            </div>
          ) : state.parsedBundle ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
              <PreviewStep parsedBundle={state.parsedBundle} />
            </div>
          ) : null}
        </Stack>
      </Dialog>

      <ConfirmDialog
        open={confirmReplaceSlug !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmReplaceSlug(null);
        }}
        title={t('upload.replaceTitle', {
          defaultValue: 'Replace existing automation?',
        })}
        description={t('upload.replaceDescription', {
          defaultValue:
            'A private automation named "{slug}" already exists. Uploading will overwrite its current contents.',
          slug: confirmReplaceSlug ?? '',
        })}
        confirmText={t('upload.replaceConfirm', { defaultValue: 'Replace' })}
        isLoading={state.isSubmitting}
        variant="destructive"
        onConfirm={() => void submit(true)}
      />
    </>
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function extractErrorMessage(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return undefined;
}
