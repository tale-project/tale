'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  isAbortError,
  useSkillBundleUpload,
} from './hooks/use-skill-bundle-upload';
import { useUploadSkill } from './hooks/use-upload-skill';
import { PreviewStep } from './steps/preview-step';
import { UploadStep } from './steps/upload-step';

/**
 * The library dialog's upload pane: pick (zip or folder) → preview → submit
 * through the four-hop storage flow, with the replace-an-existing-bundle
 * confirmation stacked on top.
 */
export function SkillUploadPane({
  organizationId,
  mode,
  onUploaded,
  onCancel,
}: {
  organizationId: string;
  mode: 'zip' | 'folder';
  /** Called with the slug once the upload has landed on disk. */
  onUploaded: (slug: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT('skills');
  const { t: tCommon } = useT('common');

  const state = useUploadSkill();
  const { upload, isMountedRef } = useSkillBundleUpload(organizationId);
  const [confirmReplaceSlug, setConfirmReplaceSlug] = useState<string | null>(
    null,
  );

  const runUpload = useCallback(
    async (force: boolean): Promise<boolean> => {
      const bundle = state.parsedBundle;
      if (!bundle) return false;
      const outcome = await upload(bundle.zipFile, force);
      if (outcome.status === 'aborted') return false;
      if (outcome.status === 'needs_confirm') {
        if (isMountedRef.current) setConfirmReplaceSlug(outcome.slug);
        return false;
      }
      return true;
    },
    [state.parsedBundle, upload, isMountedRef],
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
              ? t('upload.replaceSuccess')
              : t('upload.uploadSuccess'),
            variant: 'success',
          });
          onUploaded(slug);
        }
        // landed=false → the confirm dialog picks it up; the pane stays.
      } catch (err) {
        if (isAbortError(err)) return;
        toast({
          title: t('upload.uploadFailed'),
          description: extractErrorMessage(err),
          variant: 'destructive',
        });
      } finally {
        if (isMountedRef.current) state.setIsSubmitting(false);
      }
    },
    [state, runUpload, isMountedRef, t, onUploaded],
  );

  return (
    <>
      <Stack gap={4} className="h-full min-h-0">
        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          <div className="mx-auto w-full max-w-3xl">
            {state.step === 'upload' ? (
              <UploadStep mode={mode} onBundleParsed={state.setParsedBundle} />
            ) : state.parsedBundle ? (
              <PreviewStep parsedBundle={state.parsedBundle} />
            ) : null}
          </div>
        </div>

        <Row gap={2} justify="end" className="shrink-0">
          {state.step === 'upload' ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
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
                  ? t('upload.submitting')
                  : t('upload.submit')}
              </Button>
            </>
          )}
        </Row>
      </Stack>

      <ConfirmDialog
        open={confirmReplaceSlug !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmReplaceSlug(null);
        }}
        title={t('upload.replaceTitle')}
        description={t('upload.replaceDescription', {
          slug: confirmReplaceSlug ?? '',
        })}
        confirmText={t('upload.replaceConfirm')}
        isLoading={state.isSubmitting}
        variant="destructive"
        onConfirm={() => void submit(true)}
      />
    </>
  );
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
