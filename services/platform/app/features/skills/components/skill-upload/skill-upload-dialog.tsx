'use client';

import { Button } from '@tale/ui/button';
import { useAction } from 'convex/react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { fetchJson } from '@/lib/utils/type-cast-helpers';

import { useGenerateUploadUrl } from '../../hooks/mutations';
import { useUploadSkill } from './hooks/use-upload-skill';
import { PreviewStep } from './steps/preview-step';
import { UploadStep } from './steps/upload-step';

interface SkillUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Called with the slug once the upload has landed on disk. */
  onUploaded?: (slug: string) => void;
}

export function SkillUploadDialog({
  open,
  onOpenChange,
  organizationId,
  onUploaded,
}: SkillUploadDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const uploadFn = useAction(api.skills.file_actions.uploadSkillBundle);

  const state = useUploadSkill();
  const [confirmReplaceSlug, setConfirmReplaceSlug] = useState<string | null>(
    null,
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        state.reset();
        setConfirmReplaceSlug(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, state],
  );

  // Run the actual upload (presign → POST → action). Returns true when the
  // bundle landed, false when the server needs explicit replace confirmation.
  const runUpload = useCallback(
    async (force: boolean): Promise<boolean> => {
      const bundle = state.parsedBundle;
      if (!bundle) return false;

      const uploadUrl = await generateUploadUrl({});
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: bundle.zipFile,
      });
      if (!resp.ok) {
        throw new Error(`Upload failed (HTTP ${resp.status})`);
      }
      const { storageId } = await fetchJson<{ storageId: string }>(resp);

      const result = await uploadFn({
        organizationId,
        storageId: toId<'_storage'>(storageId),
        ...(force ? { force: true } : {}),
      });

      if (!result.ok) {
        setConfirmReplaceSlug(result.slug);
        return false;
      }
      return true;
    },
    [state.parsedBundle, generateUploadUrl, uploadFn, organizationId],
  );

  const handleSubmit = useCallback(async () => {
    if (!state.parsedBundle || state.isSubmitting) return;
    state.setIsSubmitting(true);
    try {
      const landed = await runUpload(false);
      if (landed) {
        const slug = state.parsedBundle.slug;
        toast({
          title: t('skills.upload.uploadSuccess', {
            defaultValue: 'Skill bundle uploaded',
          }),
          variant: 'success',
        });
        handleOpenChange(false);
        onUploaded?.(slug);
      }
      // landed=false → confirm dialog will pick it up; keep dialog open.
    } catch (err) {
      toast({
        title: t('skills.upload.uploadFailed', {
          defaultValue: 'Failed to upload skill bundle',
        }),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      state.setIsSubmitting(false);
    }
  }, [state, runUpload, t, handleOpenChange, onUploaded]);

  const handleConfirmReplace = useCallback(async () => {
    if (!state.parsedBundle || state.isSubmitting) return;
    state.setIsSubmitting(true);
    try {
      const landed = await runUpload(true);
      setConfirmReplaceSlug(null);
      if (landed) {
        const slug = state.parsedBundle.slug;
        toast({
          title: t('skills.upload.replaceSuccess', {
            defaultValue: 'Skill bundle replaced',
          }),
          variant: 'success',
        });
        handleOpenChange(false);
        onUploaded?.(slug);
      }
    } catch (err) {
      toast({
        title: t('skills.upload.uploadFailed', {
          defaultValue: 'Failed to upload skill bundle',
        }),
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    } finally {
      state.setIsSubmitting(false);
    }
  }, [state, runUpload, t, handleOpenChange, onUploaded]);

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
            onClick={() => void handleSubmit()}
            disabled={state.isSubmitting}
          >
            {state.isSubmitting
              ? t('skills.upload.submitting', {
                  defaultValue: 'Uploading…',
                })
              : t('skills.upload.submit', {
                  defaultValue: 'Upload bundle',
                })}
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
        title={t('skills.upload.dialogTitle', {
          defaultValue: 'Upload skill bundle',
        })}
        size="xl"
        footer={footer}
        className="max-h-[90vh] grid-rows-[auto_1fr_auto] overflow-hidden"
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          {state.step === 'upload' ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
              <UploadStep onBundleParsed={state.setParsedBundle} />
            </div>
          ) : state.parsedBundle ? (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2">
              <PreviewStep parsedBundle={state.parsedBundle} />
            </div>
          ) : null}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmReplaceSlug !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmReplaceSlug(null);
        }}
        title={t('skills.upload.replaceTitle', {
          defaultValue: 'Replace existing skill?',
        })}
        description={t('skills.upload.replaceDescription', {
          defaultValue:
            'A skill named "{slug}" already exists. Uploading will overwrite its current contents.',
          slug: confirmReplaceSlug ?? '',
        })}
        confirmText={t('skills.upload.replaceConfirm', {
          defaultValue: 'Replace',
        })}
        isLoading={state.isSubmitting}
        variant="destructive"
        onConfirm={() => void handleConfirmReplace()}
      />
    </>
  );
}
