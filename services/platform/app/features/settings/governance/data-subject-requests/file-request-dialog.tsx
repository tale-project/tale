'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useToast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import {
  ERASURE_REASON_CODES,
  type ErasureReasonCode,
} from '@/convex/governance/erasure_constants';
import { useT } from '@/lib/i18n/client';

import { mapDsrError } from './data-subject-requests-errors';
import { useRequestErasure } from './hooks/mutations';
import { useOrgMembersForErasurePicker } from './hooks/queries';
import { LegalHoldBlockPanel } from './legal-hold-block-panel';

/**
 * Locale-stable confirm phrase. Industry pattern (GitHub repo deletion,
 * AWS S3 bucket policy removal): the typed phrase stays in English so
 * the typing requirement is the same across languages — only the
 * surrounding label localizes.
 */
const ERASURE_CONFIRM_PHRASE = 'ERASE';

interface FileRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

interface FormValues {
  targetUserId: string;
  reasonCode: ErasureReasonCode;
  reason: string;
}

export function FileRequestDialog({
  open,
  onOpenChange,
  organizationId,
}: FileRequestDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { mutateAsync, isPending } = useRequestErasure();
  const members = useOrgMembersForErasurePicker(organizationId);
  const [confirmText, setConfirmText] = useState('');
  const [legalHoldBlock, setLegalHoldBlock] = useState<{
    requestId: Id<'gdprErasureRequests'>;
  } | null>(null);

  const memberOptions = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        value: m.userId,
        label: m.displayName,
        description: m.email !== m.displayName ? m.email : undefined,
      })),
    [members.data],
  );

  const reasonCodeOptions = useMemo(
    () =>
      ERASURE_REASON_CODES.map((value) => ({
        value,
        label: t(`dataSubjectRequests.reasonCodes.${value}.label`),
      })),
    [t],
  );

  const schema = useMemo(
    () =>
      z.object({
        targetUserId: z
          .string()
          .trim()
          .min(1, t('dataSubjectRequests.errors.validation')),
        reasonCode: z.enum(ERASURE_REASON_CODES),
        reason: z
          .string()
          .trim()
          .min(10, t('dataSubjectRequests.errors.reasonTooShort'))
          .max(2000),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      targetUserId: '',
      reasonCode: 'no_longer_necessary',
      reason: '',
    },
  });
  const { handleSubmit, register, formState, reset, watch, setValue } = form;
  const targetUserId = watch('targetUserId');
  const reasonCode = watch('reasonCode');

  // Reset the confirm-phrase + inline block panel whenever the dialog
  // closes — re-opening should always start from a clean state.
  useEffect(() => {
    if (!open) {
      setConfirmText('');
      setLegalHoldBlock(null);
    }
  }, [open]);

  const confirmed = confirmText.trim() === ERASURE_CONFIRM_PHRASE;

  const onSubmit = handleSubmit(async (values) => {
    if (!confirmed) return;
    setLegalHoldBlock(null);
    try {
      const { requestId } = await mutateAsync({
        organizationId,
        userId: values.targetUserId,
        reason: values.reason.trim(),
        reasonCode: values.reasonCode,
      });
      toast({
        title: t('dataSubjectRequests.toasts.filedTitle'),
        description: t('dataSubjectRequests.toasts.filedDescription'),
        variant: 'success',
      });
      onOpenChange(false);
      reset();
      setConfirmText('');
      void navigate({
        to: '/dashboard/$id/settings/governance/data-subject-requests/$requestId',
        params: { id: organizationId, requestId },
      });
    } catch (err) {
      const mapped = mapDsrError(err, t);
      if (mapped.legalHoldBlock) {
        setLegalHoldBlock({
          requestId:
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- error payload carries the row id we just inserted
            mapped.legalHoldBlock.requestId as Id<'gdprErasureRequests'>,
        });
        return;
      }
      toast({
        title: mapped.title,
        description: mapped.description,
        variant: 'destructive',
      });
    }
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset();
      setConfirmText('');
      setLegalHoldBlock(null);
    }
    onOpenChange(next);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('dataSubjectRequests.dialogs.fileRequest.title')}
      description={t('dataSubjectRequests.dialogs.fileRequest.description')}
      isSubmitting={isPending}
      isValid={formState.isValid && confirmed}
      onSubmit={onSubmit}
      submitText={t('dataSubjectRequests.dialogs.fileRequest.submit')}
    >
      <FormSection>
        <SearchableSelect
          id="dsr-user-target"
          label={t('dataSubjectRequests.dialogs.fileRequest.userPickerLabel')}
          placeholder={t(
            'dataSubjectRequests.dialogs.fileRequest.userPickerPlaceholder',
          )}
          required
          value={targetUserId || null}
          onValueChange={(value) =>
            setValue('targetUserId', value, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          options={memberOptions}
          emptyText={t(
            'dataSubjectRequests.dialogs.fileRequest.userPickerEmpty',
          )}
          error={!!formState.errors.targetUserId}
        />
        <Select
          id="dsr-reason-code"
          label={t('dataSubjectRequests.dialogs.fileRequest.reasonCodeLabel')}
          description={t(
            'dataSubjectRequests.dialogs.fileRequest.reasonCodeDescription',
          )}
          value={reasonCode}
          onValueChange={(value) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options are constrained to ErasureReasonCode
            setValue('reasonCode', value as ErasureReasonCode, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          options={reasonCodeOptions}
        />
        <Textarea
          id="dsr-reason"
          rows={3}
          label={t('dataSubjectRequests.dialogs.fileRequest.reasonLabel')}
          placeholder={t(
            'dataSubjectRequests.dialogs.fileRequest.reasonPlaceholder',
          )}
          required
          {...register('reason')}
          errorMessage={formState.errors.reason?.message}
        />
        <Input
          id="dsr-confirm"
          label={t('dataSubjectRequests.dialogs.fileRequest.confirmLabel', {
            phrase: ERASURE_CONFIRM_PHRASE,
          })}
          description={t(
            'dataSubjectRequests.dialogs.fileRequest.confirmDescription',
          )}
          required
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          autoComplete="off"
          placeholder={ERASURE_CONFIRM_PHRASE}
        />
        {legalHoldBlock && (
          <LegalHoldBlockPanel
            organizationId={organizationId}
            requestId={legalHoldBlock.requestId}
          />
        )}
      </FormSection>
    </FormDialog>
  );
}
