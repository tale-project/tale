'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle } from 'lucide-react';
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
import { useT } from '@/lib/i18n/client';

import { usePlaceLegalHold } from '../hooks/mutations';
import { useLegalMatters, useOrgMembersForPicker } from '../hooks/queries';
import { mapLegalHoldError } from './legal-hold-errors';
import { UpsertMatterDialog } from './upsert-matter-dialog';

/**
 * UI-facing target types: only User (custodian) and Org (tenant-wide).
 * The mutation API still accepts thread/document/execution for legacy
 * data + advanced callers, but the operator picker no longer surfaces
 * them — the cleaner mental model for legal/compliance teams is
 * "preserve user X's data" or "preserve everything in this org".
 */
const PICKER_TARGET_TYPES = ['userMembership', 'org'] as const;

type PickerTargetType = (typeof PICKER_TARGET_TYPES)[number];

/**
 * Fixed English phrase the operator must type to confirm an org-wide
 * hold. Industry pattern (GitHub repo deletion, AWS S3 bucket policy
 * removal). Kept locale-stable so the typing requirement is the same
 * across languages — the surrounding label localizes.
 */
const ORG_CONFIRM_PHRASE = 'ORG-WIDE HOLD';

interface PlaceHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}

interface FormValues {
  targetType: PickerTargetType;
  targetId: string;
  reason: string;
  matterRef: string;
}

export function PlaceHoldDialog({
  open,
  onOpenChange,
  organizationId,
}: PlaceHoldDialogProps) {
  const { t } = useT('governance');
  const { toast } = useToast();
  const { mutateAsync, isPending } = usePlaceLegalHold();
  const matters = useLegalMatters(organizationId, { status: 'open' });
  const members = useOrgMembersForPicker(organizationId);
  const [createMatterOpen, setCreateMatterOpen] = useState(false);
  const [orgConfirmText, setOrgConfirmText] = useState('');

  const targetTypeOptions = useMemo(
    () =>
      PICKER_TARGET_TYPES.map((value) => ({
        value,
        label: t(`legalHold.targetTypes.${value}`),
      })),
    [t],
  );

  const matterOptions = useMemo(
    () =>
      (matters.data ?? []).map((m) => ({
        value: String(m._id),
        label: m.name,
        description: m.caseNumber,
      })),
    [matters.data],
  );

  const memberOptions = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        value: m.userId,
        label: m.displayName,
        description: m.email !== m.displayName ? m.email : undefined,
      })),
    [members.data],
  );

  const schema = useMemo(
    () =>
      z.object({
        targetType: z.enum(PICKER_TARGET_TYPES),
        targetId: z.string().trim().min(1, t('legalHold.errors.validation')),
        reason: z
          .string()
          .trim()
          .min(1, t('legalHold.errors.validation'))
          .max(2000),
        matterRef: z.string(),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      targetType: 'userMembership',
      targetId: '',
      reason: '',
      matterRef: '',
    },
  });
  const { handleSubmit, register, formState, reset, watch, setValue } = form;
  const targetType = watch('targetType');
  const targetId = watch('targetId');
  const matterRef = watch('matterRef');

  // Auto-fill targetId for org-scope so operators don't have to know
  // that the literal value must equal the organizationId; clear it back
  // when they switch back to user. Also reset the typed confirmation
  // whenever target type changes — switching away from org and back
  // shouldn't preserve a previously-typed confirmation.
  useEffect(() => {
    if (targetType === 'org') {
      if (targetId !== organizationId) {
        setValue('targetId', organizationId, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } else {
      if (targetId === organizationId) {
        setValue('targetId', '', {
          shouldDirty: false,
          shouldValidate: false,
        });
      }
      if (orgConfirmText !== '') setOrgConfirmText('');
    }
  }, [organizationId, setValue, targetId, targetType, orgConfirmText]);

  const orgConfirmed =
    targetType !== 'org' || orgConfirmText.trim() === ORG_CONFIRM_PHRASE;

  const onSubmit = handleSubmit(async (values) => {
    // Defense-in-depth: the submit button is disabled when
    // `orgConfirmed` is false, but a determined user can drop the
    // disabled attribute via devtools or trigger handleSubmit
    // programmatically. Re-check here so the org-wide hold gate
    // cannot be bypassed without typing the phrase. Round-2 review
    // CRITICAL #19 / F.3.
    if (!orgConfirmed) return;
    try {
      await mutateAsync({
        organizationId,
        targetType: values.targetType,
        targetId: values.targetId.trim(),
        reason: values.reason.trim(),
        matterRef: values.matterRef ? values.matterRef : undefined,
      });
      toast({
        title: t('legalHold.toasts.placedTitle'),
        description: t('legalHold.toasts.placedDescription', {
          targetType: t(`legalHold.targetTypes.${values.targetType}`),
        }),
        variant: 'success',
      });
      onOpenChange(false);
      reset();
      setOrgConfirmText('');
    } catch (err) {
      const mapped = mapLegalHoldError(err, t);
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
      setOrgConfirmText('');
    }
    onOpenChange(next);
  };

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t('legalHold.dialogs.placeHold.title')}
        description={t('legalHold.dialogs.placeHold.description')}
        isSubmitting={isPending}
        isValid={formState.isValid && orgConfirmed}
        onSubmit={onSubmit}
        submitText={t('legalHold.dialogs.placeHold.submit')}
      >
        <FormSection>
          <Select
            id="hold-target-type"
            label={t('legalHold.dialogs.placeHold.targetTypeLabel')}
            value={targetType}
            onValueChange={(value) =>
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Select options are constrained to PickerTargetType
              setValue('targetType', value as PickerTargetType, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            options={targetTypeOptions}
          />
          {targetType === 'userMembership' ? (
            <SearchableSelect
              id="hold-user-target"
              label={t('legalHold.dialogs.placeHold.userPickerLabel')}
              placeholder={t(
                'legalHold.dialogs.placeHold.userPickerPlaceholder',
              )}
              required
              value={targetId || null}
              onValueChange={(value) =>
                setValue('targetId', value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              options={memberOptions}
              emptyText={t('legalHold.dialogs.placeHold.userPickerEmpty')}
              error={!!formState.errors.targetId}
            />
          ) : (
            <>
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{t('legalHold.dialogs.placeHold.orgWarning')}</span>
              </div>
              <Input
                id="hold-org-confirm"
                label={t('legalHold.dialogs.placeHold.orgConfirmLabel', {
                  phrase: ORG_CONFIRM_PHRASE,
                })}
                description={t(
                  'legalHold.dialogs.placeHold.orgConfirmDescription',
                )}
                required
                value={orgConfirmText}
                onChange={(e) => setOrgConfirmText(e.target.value)}
                autoComplete="off"
                placeholder={ORG_CONFIRM_PHRASE}
              />
            </>
          )}
          <Textarea
            id="hold-reason"
            rows={3}
            label={t('legalHold.dialogs.placeHold.reasonLabel')}
            placeholder={t('legalHold.dialogs.placeHold.reasonPlaceholder')}
            required
            {...register('reason')}
            errorMessage={formState.errors.reason?.message}
          />
          <SearchableSelect
            id="hold-matter"
            label={t('legalHold.dialogs.placeHold.matterLabel')}
            placeholder={t('legalHold.dialogs.placeHold.matterPlaceholder')}
            value={matterRef || null}
            onValueChange={(value) =>
              setValue('matterRef', value, { shouldDirty: true })
            }
            options={matterOptions}
            footer={
              <button
                type="button"
                className="text-primary hover:bg-accent w-full px-3 py-2 text-left text-sm"
                onClick={() => setCreateMatterOpen(true)}
              >
                {t('legalHold.dialogs.placeHold.matterCreateNew')}
              </button>
            }
          />
        </FormSection>
      </FormDialog>
      <UpsertMatterDialog
        open={createMatterOpen}
        onOpenChange={setCreateMatterOpen}
        organizationId={organizationId}
        onSuccess={(matterId: Id<'legalMatters'>) =>
          setValue('matterRef', String(matterId), {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />
    </>
  );
}
