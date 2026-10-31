'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@tale/ui/alert';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Select } from '@tale/ui/select';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useToast } from '@tale/ui/use-toast';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import type { CompetenceRecordWire } from '@/app/lib/backend/contract/governance';
import { useT } from '@/lib/i18n/client';

import { useUpdateCompetence } from '../hooks/mutations';
import { mapCompetenceError } from './competence-errors';
import {
  EVIDENCE_MAX,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiresAtFor,
  isExpiryChoice,
} from './competence-expiry';

/** The expiry choice that leaves the grant's end date as it is. */
const KEEP = 'keep';
type EditExpiry = typeof KEEP | ExpiryChoice;

interface FormValues {
  expiry: EditExpiry;
  evidence: string;
}

interface EditCompetenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** An active grant; the register refuses to change any other. */
  record: CompetenceRecordWire;
  /** The grant's name and its holder, as the register shows them. */
  competenceName: string;
  memberName: string;
  /** A refusal often means someone changed the grant meanwhile (revoked,
   * expired, gone): the register reloads behind the dialog. */
  onRefused: () => void;
}

/**
 * Change an active grant's end date and evidence in place (GOV-R18). A new
 * end date counts from the moment the admin saves, like a grant's; the
 * audit log records each change.
 */
export function EditCompetenceDialog({
  open,
  onOpenChange,
  organizationId,
  record,
  competenceName,
  memberName,
  onRefused,
}: EditCompetenceDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { formatDate } = useFormatDate();
  const { mutateAsync, isPending } = useUpdateCompetence();
  // A refusal the admin can act on stays in the form, beside the fields.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        expiry: z.enum([KEEP, ...EXPIRY_CHOICES]),
        evidence: z
          .string()
          .trim()
          .max(
            EVIDENCE_MAX,
            t('competences.grantDialog.validation.evidenceTooLong'),
          ),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      // An open-ended grant already reads as Never; a dated one keeps its
      // date until the admin picks another.
      expiry: record.expiresAt === null ? 'never' : KEEP,
      evidence: record.evidence ?? '',
    },
  });
  const { register, handleSubmit, formState, reset, setValue, watch } = form;
  const expiry = watch('expiry');

  const expiryOptions = useMemo(
    () => [
      ...(record.expiresAt === null
        ? []
        : [
            {
              value: KEEP,
              label: t('competences.editDialog.expiryKeep', {
                date: formatDate(new Date(record.expiresAt), 'short'),
              }),
            },
          ]),
      ...EXPIRY_CHOICES.map((choice) => ({
        value: choice,
        label: t(`competences.grantDialog.expiryOptions.${choice}`),
      })),
    ],
    [record.expiresAt, formatDate, t],
  );

  const close = () => {
    reset();
    setSubmitError(null);
    onOpenChange(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const expiresAt =
      values.expiry === KEEP
        ? record.expiresAt
        : expiresAtFor(values.expiry, Date.now());
    const evidence = values.evidence.trim();
    const changes = {
      ...(expiresAt === record.expiresAt ? {} : { expiresAt }),
      ...(evidence === (record.evidence ?? '')
        ? {}
        : { evidence: evidence === '' ? null : evidence }),
    };
    // Only whitespace was touched: there is nothing to save.
    if (Object.keys(changes).length === 0) {
      close();
      return;
    }
    try {
      await mutateAsync({ organizationId, recordId: record.id, ...changes });
      toast({ title: t('competences.toasts.updated'), variant: 'success' });
      close();
    } catch (err) {
      setSubmitError(mapCompetenceError(err, t));
      onRefused();
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      title={t('competences.editDialog.title')}
      description={t('competences.editDialog.description', {
        competence: competenceName,
        member: memberName,
      })}
      isSubmitting={isPending}
      isDirty={formState.isDirty}
      isValid={formState.isValid}
      onSubmit={onSubmit}
      submitText={t('competences.editDialog.submit')}
    >
      <FormSection>
        {submitError !== null && (
          <Alert variant="destructive" description={submitError} />
        )}
        <Select
          id="competence-edit-expiry"
          label={t('competences.grantDialog.expiryLabel')}
          value={expiry}
          onValueChange={(value) => {
            if (value === KEEP || isExpiryChoice(value)) {
              setSubmitError(null);
              setValue('expiry', value, { shouldDirty: true });
            }
          }}
          options={expiryOptions}
        />
        <Textarea
          id="competence-edit-evidence"
          rows={3}
          label={t('competences.grantDialog.evidenceLabel')}
          description={t('competences.grantDialog.evidenceDescription')}
          {...register('evidence')}
          errorMessage={formState.errors.evidence?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
