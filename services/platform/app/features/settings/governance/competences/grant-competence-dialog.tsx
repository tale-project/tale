'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { SearchableSelect } from '@tale/ui/searchable-select';
import { Select } from '@tale/ui/select';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import * as z from 'zod';

import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';
import {
  isPlatformCapability,
  isReservedCompetenceSlug,
  PLATFORM_CAPABILITIES,
  type PlatformCapability,
} from '@/lib/shared/competences';

import { useGrantCompetence } from '../hooks/mutations';
import { useMyModelApiAccess, useOrgMembersForPicker } from '../hooks/queries';
import { mapCompetenceError } from './competence-errors';
import {
  EVIDENCE_MAX,
  EXPIRY_CHOICES,
  type ExpiryChoice,
  expiresAtFor,
  isExpiryChoice,
} from './competence-expiry';
import { capabilityMessageKey } from './competence-labels';

/** The competence picker's entry for an organization's own qualification. */
const QUALIFICATION = 'qualification';

/** The capability whose calls also wait for the organization's model
 * endpoints switch (`backend/domains/model_api/access.ts`). */
const MODEL_API_CAPABILITY: PlatformCapability = 'tale:models.api';

/** The longest competence name the register accepts. */
const COMPETENCE_MAX = 120;

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
  // Until the member list answers it offers nobody, and that never reads as
  // nobody to grant to (#4586): a pending read masks the picker, a failed
  // one names the list with Try again above it.
  const membersAnswered = members.data !== undefined;
  const membersRead = readStateOf(members);
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
  // The switch as the server reads it for every surface (`readModelApiStanding`,
  // an unreadable policy reading as off); the settings rail already holds this
  // read. Only an answer says the endpoints are off (#4586), and the grant
  // stays allowed either way: its holder calls the models once they are on.
  const modelApi = useMyModelApiAccess(organizationId);
  const modelApiOff =
    competence === MODEL_API_CAPABILITY && modelApi.data?.enabled === false;

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
    const expiresAt = expiresAtFor(values.expiry, Date.now());
    const evidence = values.evidence.trim();
    try {
      await mutateAsync({
        organizationId,
        userId: values.userId,
        competence:
          values.competence === QUALIFICATION
            ? values.qualification.trim()
            : values.competence,
        ...(expiresAt !== null ? { expiresAt } : {}),
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
        {membersRead.unavailable && (
          <CatalogLoadError
            message={t('competences.grantDialog.memberLoadFailed')}
            failureKey={membersRead.failureCount}
            isRetrying={membersRead.retrying}
            onRetry={() => void members.refetch()}
            // A retry that brings the list takes the alert away: the focus
            // it held goes to the picker, not the page.
            onFocusLost={() =>
              document.getElementById('competence-member')?.focus()
            }
          />
        )}
        <Skeletonize loading={!membersAnswered && !membersRead.unavailable}>
          <SearchableSelect
            id="competence-member"
            label={t('competences.grantDialog.memberLabel')}
            placeholder={t('competences.grantDialog.memberPlaceholder')}
            searchPlaceholder={t('competences.grantDialog.memberSearch')}
            emptyText={t('competences.grantDialog.memberEmpty')}
            required
            disabled={!membersAnswered}
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
        </Skeletonize>
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
        {modelApiOff && (
          <Alert
            variant="warning"
            description={
              <>
                {t('competences.grantDialog.modelApiOff.description')}{' '}
                <Link
                  to="/dashboard/$id/settings/governance/content-models"
                  params={{ id: organizationId }}
                  className="text-foreground underline underline-offset-4"
                >
                  {t('competences.grantDialog.modelApiOff.link')}
                </Link>
              </>
            }
          />
        )}
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
