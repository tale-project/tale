'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@tale/ui/alert';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import { useT } from '@/lib/i18n/client';
import {
  isPlatformCapability,
  isReservedCompetenceSlug,
  PLATFORM_CAPABILITIES,
} from '@/lib/shared/competences';

import { useGrantCompetence } from '../hooks/mutations';
import { useOrgMembersForPicker } from '../hooks/queries';
import { mapCompetenceError } from './competence-errors';
import { capabilityMessageKey } from './competence-labels';

/** The competence picker's entry for an organization's own qualification. */
const QUALIFICATION = 'qualification';

/** The longest competence name and evidence the register accepts. */
const COMPETENCE_MAX = 120;
const EVIDENCE_MAX = 2000;

const DAY_SECONDS = 24 * 60 * 60;
const EXPIRY_CHOICES = ['never', '30days', '90days', '1year'] as const;
type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];
const EXPIRY_SECONDS: Record<ExpiryChoice, number> = {
  never: 0,
  '30days': 30 * DAY_SECONDS,
  '90days': 90 * DAY_SECONDS,
  '1year': 365 * DAY_SECONDS,
};

function isExpiryChoice(value: string): value is ExpiryChoice {
  return (EXPIRY_CHOICES as readonly string[]).includes(value);
}

interface FormValues {
  userId: string;
  competence: string;
  qualification: string;
  expiry: ExpiryChoice;
  evidence: string;
}

interface GrantCompetenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

export function GrantCompetenceDialog({
  open,
  onOpenChange,
  organizationId,
}: GrantCompetenceDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = useGrantCompetence();
  const members = useOrgMembersForPicker(open ? organizationId : undefined);
  // A refusal the admin can act on stays in the form, beside the fields.
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          userId: z
            .string()
            .min(1, t('competences.grantDialog.validation.memberRequired')),
          competence: z
            .string()
            .min(1, t('competences.grantDialog.validation.competenceRequired')),
          qualification: z.string(),
          expiry: z.enum(EXPIRY_CHOICES),
          evidence: z
            .string()
            .trim()
            .max(
              EVIDENCE_MAX,
              t('competences.grantDialog.validation.evidenceTooLong'),
            ),
        })
        .superRefine((values, ctx) => {
          if (values.competence !== QUALIFICATION) return;
          const name = values.qualification.trim();
          const message =
            name.length === 0
              ? t('competences.grantDialog.validation.qualificationRequired')
              : name.length > COMPETENCE_MAX
                ? t('competences.grantDialog.validation.qualificationTooLong')
                : isReservedCompetenceSlug(name)
                  ? t(
                      'competences.grantDialog.validation.qualificationReserved',
                    )
                  : undefined;
          if (message !== undefined) {
            ctx.addIssue({ code: 'custom', path: ['qualification'], message });
          }
        }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      userId: '',
      competence: '',
      qualification: '',
      expiry: 'never',
      evidence: '',
    },
  });
  const { register, handleSubmit, formState, reset, setValue, watch } = form;
  const userId = watch('userId');
  const competence = watch('competence');
  const expiry = watch('expiry');

  const memberOptions = useMemo(
    () =>
      (members.data ?? []).map((member) => ({
        value: member.userId,
        label: member.displayName,
        // The address tells two members with one name apart; it is dropped
        // when it is the name already.
        description:
          member.email !== '' && member.email !== member.displayName
            ? member.email
            : undefined,
      })),
    [members.data],
  );

  // Rows stay one line wide (a name and its slug) so the list keeps the
  // field's width; the chosen capability's full explanation shows under the
  // field instead.
  const competenceOptions = useMemo(
    () => [
      {
        value: 'capabilities-heading',
        label: t('competences.grantDialog.capabilitiesGroup'),
        isSectionHeader: true,
      },
      ...PLATFORM_CAPABILITIES.map((capability) => ({
        value: capability,
        label: t(
          `competences.capabilities.${capabilityMessageKey(capability)}.label`,
        ),
        description: capability,
      })),
      {
        value: 'qualifications-heading',
        label: t('competences.grantDialog.qualificationsGroup'),
        isSectionHeader: true,
      },
      {
        value: QUALIFICATION,
        label: t('competences.grantDialog.qualificationOption'),
        description: t(
          'competences.grantDialog.qualificationOptionDescription',
        ),
      },
    ],
    [t],
  );

  const expiryOptions = useMemo(
    () =>
      EXPIRY_CHOICES.map((choice) => ({
        value: choice,
        label: t(`competences.grantDialog.expiryOptions.${choice}`),
      })),
    [t],
  );

  const close = () => {
    reset();
    setSubmitError(null);
    onOpenChange(false);
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    const seconds = EXPIRY_SECONDS[values.expiry];
    const evidence = values.evidence.trim();
    try {
      await mutateAsync({
        organizationId,
        userId: values.userId,
        competence:
          values.competence === QUALIFICATION
            ? values.qualification.trim()
            : values.competence,
        ...(seconds > 0 ? { expiresAt: Date.now() + seconds * 1000 } : {}),
        ...(evidence !== '' ? { evidence } : {}),
      });
      toast({ title: t('competences.toasts.granted'), variant: 'success' });
      close();
    } catch (err) {
      setSubmitError(mapCompetenceError(err, t));
    }
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else close();
      }}
      title={t('competences.grantDialog.title')}
      description={t('competences.grantDialog.description')}
      isSubmitting={isPending}
      isValid={formState.isValid}
      onSubmit={onSubmit}
      submitText={t('competences.grantDialog.submit')}
    >
      <FormSection>
        {submitError !== null && (
          <Alert variant="destructive" description={submitError} />
        )}
        <SearchableSelect
          id="competence-member"
          label={t('competences.grantDialog.memberLabel')}
          placeholder={t('competences.grantDialog.memberPlaceholder')}
          searchPlaceholder={t('competences.grantDialog.memberSearch')}
          emptyText={t('competences.grantDialog.memberEmpty')}
          required
          value={userId || null}
          onValueChange={(value) => {
            // A refusal was about the previous choice; a new one clears it.
            setSubmitError(null);
            setValue('userId', value, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          options={memberOptions}
          error={formState.errors.userId !== undefined}
        />
        <SearchableSelect
          id="competence-name"
          label={t('competences.grantDialog.competenceLabel')}
          placeholder={t('competences.grantDialog.competencePlaceholder')}
          required
          value={competence || null}
          onValueChange={(value) => {
            setSubmitError(null);
            setValue('competence', value, {
              shouldDirty: true,
              shouldValidate: true,
            });
          }}
          options={competenceOptions}
          description={
            isPlatformCapability(competence)
              ? t(
                  `competences.capabilities.${capabilityMessageKey(competence)}.description`,
                )
              : undefined
          }
          error={formState.errors.competence !== undefined}
        />
        {competence === QUALIFICATION && (
          <Input
            id="competence-qualification"
            label={t('competences.grantDialog.qualificationLabel')}
            description={t('competences.grantDialog.qualificationDescription')}
            required
            autoComplete="off"
            maxLength={COMPETENCE_MAX}
            {...register('qualification')}
            errorMessage={formState.errors.qualification?.message}
          />
        )}
        <Select
          id="competence-expiry"
          label={t('competences.grantDialog.expiryLabel')}
          value={expiry}
          onValueChange={(value) => {
            if (isExpiryChoice(value)) {
              setValue('expiry', value, { shouldDirty: true });
            }
          }}
          options={expiryOptions}
        />
        <Textarea
          id="competence-evidence"
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
