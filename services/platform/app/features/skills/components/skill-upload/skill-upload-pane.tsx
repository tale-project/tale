'use client';

import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Row, Stack } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useState } from 'react';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';
import { isAbortError } from '@/lib/utils/abort-error';

import { isSkillPublishRefusal } from '../../hooks/mutations';
import { useSkillAudience } from '../../hooks/use-skill-audience';
import type { SkillSharingValue } from '../skill-visibility-field';
import { useSkillBundleUpload } from './hooks/use-skill-bundle-upload';
import { useUploadSkill } from './hooks/use-upload-skill';
import { PreviewStep } from './steps/preview-step';
import { UploadStep } from './steps/upload-step';
import type { ParsedSkillBundle } from './utils/parse-skill-bundle';

/**
 * The library dialog's upload pane: pick (zip or folder) → preview, which
 * asks whom the skill is for → submit through the four-hop storage flow,
 * carrying that audience, with the replace-an-existing-bundle confirmation
 * stacked on top.
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
  const bundle = state.parsedBundle;
  // The member's pick holds for the bundle it was made on; a bundle picked
  // afresh starts on its own default again.
  const [picked, setPicked] = useState<{
    bundle: ParsedSkillBundle;
    sharing: SkillSharingValue;
  } | null>(null);
  const audience = useSkillAudience(organizationId, {
    picked: picked !== null && picked.bundle === bundle ? picked.sharing : null,
    ...(bundle
      ? {
          declared: {
            visibility: bundle.meta.visibility,
            teams: bundle.meta.teams ?? [],
          },
        }
      : {}),
  });
  const pickSharing = useCallback(
    (sharing: SkillSharingValue) => {
      if (bundle) setPicked({ bundle, sharing });
    },
    [bundle],
  );
  const { upload, isMountedRef } = useSkillBundleUpload(organizationId);
  const [confirmReplaceSlug, setConfirmReplaceSlug] = useState<string | null>(
    null,
  );

  const runUpload = useCallback(
    async (force: boolean): Promise<boolean> => {
      if (!bundle) return false;
      const outcome = await upload(bundle.zipFile, force, audience.sharing);
      if (outcome.status === 'aborted') return false;
      if (outcome.status === 'needs_confirm') {
        if (isMountedRef.current) setConfirmReplaceSlug(outcome.slug);
        return false;
      }
      return true;
    },
    [bundle, upload, audience.sharing, isMountedRef],
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
          // A refused audience in the viewer's language, any other refusal in
          // the door's words; a lost connection is a localized sentence, and
          // a fault (a 5xx) leaves the title alone, never its status line.
          description: isSkillPublishRefusal(err)
            ? t('publishing.refused')
            : failureDetail(err),
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
              <PreviewStep
                parsedBundle={state.parsedBundle}
                audience={audience}
                onAudienceChange={pickSharing}
              />
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
                variant="ghost"
                onClick={state.goBack}
                disabled={state.isSubmitting}
              >
                {tCommon('actions.back')}
              </Button>
              <Button
                type="button"
                onClick={() => void submit(false)}
                disabled={
                  !state.parsedBundle ||
                  audience.noAudience ||
                  audience.audienceMissing
                }
                isLoading={state.isSubmitting}
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
