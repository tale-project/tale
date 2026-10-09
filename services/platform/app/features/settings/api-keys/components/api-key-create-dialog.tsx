'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { FormSection } from '@tale/ui/form-section';
import { Input } from '@tale/ui/input';
import { Text } from '@tale/ui/text';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import dayjs from 'dayjs';
import { Copy, Check } from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import * as z from 'zod';

import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useCreateApiKey } from '../hooks/use-api-keys';
import {
  API_KEY_EXPIRY_CHOICES,
  type ApiKeyExpiryChoice,
  DEFAULT_API_KEY_EXPIRY,
  DEFAULT_CUSTOM_EXPIRY_DAYS,
  expiresInSeconds,
  expiryDays,
  isCustomExpiryInRange,
} from '../lib/expiry';
import type { ApiKeyOwnerInput, ApiKeyRole } from '../types';
import { ApiKeyExpiryField } from './api-key-expiry-field';
import {
  type ApiKeyOwnerChoice,
  ApiKeyOwnerField,
  rolesFor,
} from './api-key-owner-field';

/** Better Auth's apiKey plugin caps the key name at its `maximumNameLength`
 *  default (32) — `convex/auth.ts` sets no override. Mirror it client-side so a
 *  too-long name is rejected inline instead of returning a generic 400 toast. */
const API_KEY_NAME_MAX = 32;

interface ApiKeyCreateDialogProps {
  restoreFocusRef?: RefObject<HTMLElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Owners and Admins also make keys for a member, a team, a project or
   * the organization. */
  canCreateForOthers?: boolean;
  /** The signed-in member — never offered as "another member". */
  viewerUserId?: string;
  /** The signed-in member's role: a key never acts above it. */
  viewerRole?: string;
  onSuccess?: () => void;
}

type ApiKeyFormData = {
  name: string;
  expiry: ApiKeyExpiryChoice;
  /** The day picked under "Custom date" (local midnight, ms), or null. */
  expiryDate: number | null;
  owner: ApiKeyOwnerChoice;
  memberId: string;
  teamId: string;
  projectId: string;
  role: ApiKeyRole;
};

const OWNER_CHOICE_VALUES = [
  'self',
  'member',
  'team',
  'project',
  'organization',
] as const satisfies readonly ApiKeyOwnerChoice[];

const ROLE_VALUES = [
  'member',
  'editor',
  'developer',
  'admin',
] as const satisfies readonly ApiKeyRole[];

/** The owner the create call sends, from the form's choice. */
function ownerInput(data: ApiKeyFormData): ApiKeyOwnerInput {
  switch (data.owner) {
    case 'member':
      return { kind: 'member', userId: data.memberId };
    case 'team':
      return { kind: 'team', teamId: data.teamId, role: data.role };
    case 'project':
      return { kind: 'project', projectId: data.projectId, role: data.role };
    case 'organization':
      return { kind: 'organization', role: data.role };
    default:
      return { kind: 'self' };
  }
}

export function ApiKeyCreateDialog({
  open,
  onOpenChange,
  organizationId,
  canCreateForOthers = false,
  viewerUserId,
  viewerRole,
  onSuccess,
  restoreFocusRef,
}: ApiKeyCreateDialogProps) {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const { mutateAsync: createKey, isPending: isSubmitting } =
    useCreateApiKey(organizationId);

  const [createdKey, setCreatedKey] = useState<string | null>(null);
  /** The member a key was just made for, named on the success view. */
  const [createdFor, setCreatedFor] = useState<string | null>(null);
  /** Whether the key just made is the maker's own. */
  const [createdOwn, setCreatedOwn] = useState(true);
  const [copied, setCopied] = useState(false);
  // The lifetime counts whole days from the moment the form opened: the
  // date the field shows is the date the key gets.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useEffect(() => {
    if (open) setOpenedAt(Date.now());
  }, [open]);

  const nameRequiredError = tSettings('apiKeys.form.nameRequired');
  const nameTooLongError = tCommon('validation.maxLength', {
    field: tSettings('apiKeys.form.name'),
    max: API_KEY_NAME_MAX,
  });
  const expiryDateRequiredError = tSettings('apiKeys.form.expiryDateRequired');
  const expiryDateRangeError = tSettings('apiKeys.form.expiryDateRange');
  const targetRequiredError = tSettings('apiKeys.form.targetRequired');
  const schema = useMemo(
    () =>
      z
        .object({
          name: z
            .string()
            .trim()
            .min(1, nameRequiredError)
            .max(API_KEY_NAME_MAX, nameTooLongError),
          expiry: z.enum(API_KEY_EXPIRY_CHOICES),
          expiryDate: z.number().nullable(),
          owner: z.enum(OWNER_CHOICE_VALUES),
          memberId: z.string(),
          teamId: z.string(),
          projectId: z.string(),
          role: z.enum(ROLE_VALUES),
        })
        .superRefine((data, ctx) => {
          const target =
            data.owner === 'member'
              ? 'memberId'
              : data.owner === 'team'
                ? 'teamId'
                : data.owner === 'project'
                  ? 'projectId'
                  : null;
          if (target !== null && data[target] === '') {
            ctx.addIssue({
              code: 'custom',
              path: [target],
              message: targetRequiredError,
            });
          }
          if (data.expiry !== 'custom') return;
          if (data.expiryDate === null) {
            ctx.addIssue({
              code: 'custom',
              path: ['expiryDate'],
              message: expiryDateRequiredError,
            });
          } else if (!isCustomExpiryInRange(data.expiryDate, openedAt)) {
            ctx.addIssue({
              code: 'custom',
              path: ['expiryDate'],
              message: expiryDateRangeError,
            });
          }
        }),
    [
      nameRequiredError,
      nameTooLongError,
      expiryDateRequiredError,
      expiryDateRangeError,
      targetRequiredError,
      openedAt,
    ],
  );

  const form = useForm<ApiKeyFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      expiry: DEFAULT_API_KEY_EXPIRY,
      expiryDate: null,
      owner: 'self',
      memberId: '',
      teamId: '',
      projectId: '',
      role: 'member',
    },
  });

  const { handleSubmit, register, reset, formState, setValue, watch } = form;
  const expiry = watch('expiry');
  const expiryDate = watch('expiryDate');
  const owner = watch('owner');
  /** The picked member's name, for the success view. */
  const [memberName, setMemberName] = useState<string | null>(null);

  const onSubmit = async (data: ApiKeyFormData) => {
    const days = expiryDays(data.expiry, data.expiryDate, openedAt);
    // The schema refuses a custom choice without a date.
    if (days === undefined) return;
    try {
      const result = await createKey({
        name: data.name,
        expiresIn: expiresInSeconds(days),
        owner: canCreateForOthers ? ownerInput(data) : { kind: 'self' },
      });

      setCreatedKey(result.key);
      setCreatedFor(
        canCreateForOthers && data.owner === 'member' ? memberName : null,
      );
      setCreatedOwn(!canCreateForOthers || data.owner === 'self');

      toast({
        title: tSettings('apiKeys.keyCreated'),
        variant: 'success',
      });

      onSuccess?.();
    } catch (error) {
      console.error(error);
      toast({
        title: tSettings('apiKeys.keyCreateFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    }
  };

  const handleCopyKey = async () => {
    if (!createdKey) return;

    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      toast({
        title: tSettings('apiKeys.keyCopied'),
        variant: 'success',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: tCommon('errors.failedToCopy'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      reset();
      setCreatedKey(null);
      setCreatedFor(null);
      setCreatedOwn(true);
      setMemberName(null);
      setCopied(false);
    }
    onOpenChange(newOpen);
  };

  if (createdKey) {
    return (
      <FormDialog
        restoreFocusRef={restoreFocusRef}
        open={open}
        onOpenChange={handleOpenChange}
        title={tSettings('apiKeys.keyCreated')}
        submitText={tCommon('actions.done')}
        isSubmitting={false}
        onSubmit={() => handleOpenChange(false)}
        customFooter={
          <Button type="submit" onClick={() => handleOpenChange(false)}>
            {tCommon('actions.done')}
          </Button>
        }
      >
        <FormSection>
          <Text variant="muted">
            {createdOwn
              ? tSettings('apiKeys.keyCreatedDescription')
              : tSettings('apiKeys.keyCreatedDescriptionForOthers')}
          </Text>
          {createdFor !== null && (
            <Text variant="muted">
              {tSettings('apiKeys.keyCreatedForMember', { name: createdFor })}
            </Text>
          )}
          <div className="space-y-2">
            <Text as="label" variant="label">
              {createdOwn
                ? tSettings('apiKeys.yourApiKey')
                : tSettings('apiKeys.newApiKey')}
            </Text>
            <div className="relative">
              <code className="bg-muted block w-full rounded-md p-3 pr-12 font-mono text-sm break-all">
                {createdKey}
              </code>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCopyKey}
                className="absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={tCommon('actions.copy')}
              >
                {copied ? (
                  <Check className="text-success size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </FormSection>
      </FormDialog>
    );
  }

  return (
    <FormDialog
      restoreFocusRef={restoreFocusRef}
      open={open}
      onOpenChange={handleOpenChange}
      title={tSettings('apiKeys.createKey')}
      submitText={tSettings('apiKeys.createKeySubmit')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      isValid={formState.isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        {/* A person's own key is theirs, not the organization's — the page
            lives under one organization, so the dialog says what the key
            spans. An Owner or Admin chooses whose key it is below, and the
            choice says the same. */}
        {!canCreateForOthers && (
          <Text variant="muted">{tSettings('apiKeys.form.scopeHint')}</Text>
        )}
        <Input
          id="name"
          label={tSettings('apiKeys.form.name')}
          placeholder={tSettings('apiKeys.form.namePlaceholder')}
          {...register('name')}
          className="w-full"
          required
          errorMessage={formState.errors.name?.message}
        />
        {canCreateForOthers && (
          <ApiKeyOwnerField
            organizationId={organizationId}
            viewerUserId={viewerUserId}
            viewerRole={viewerRole}
            choice={owner}
            onChoiceChange={(choice) => {
              setValue('owner', choice, {
                shouldDirty: true,
                shouldValidate: true,
              });
              // A role the new choice does not offer (an admin organization
              // key turned into a team key) falls back to Member.
              if (!rolesFor(choice, viewerRole).includes(watch('role'))) {
                setValue('role', 'member', { shouldValidate: true });
              }
            }}
            memberId={watch('memberId')}
            onMemberChange={(userId, name) => {
              setMemberName(name);
              setValue('memberId', userId, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            teamId={watch('teamId')}
            onTeamChange={(teamId) =>
              setValue('teamId', teamId, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            projectId={watch('projectId')}
            onProjectChange={(projectId) =>
              setValue('projectId', projectId, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            role={watch('role')}
            onRoleChange={(role) =>
              setValue('role', role, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            targetError={
              formState.errors.memberId?.message ??
              formState.errors.teamId?.message ??
              formState.errors.projectId?.message
            }
            onTargetClosed={() => {
              // A picker closed without a choice says why Create stays off.
              if (owner === 'member') void form.trigger('memberId');
              if (owner === 'team') void form.trigger('teamId');
              if (owner === 'project') void form.trigger('projectId');
            }}
          />
        )}
        <ApiKeyExpiryField
          choice={expiry}
          customDate={expiryDate}
          now={openedAt}
          onChoiceChange={(choice) => {
            setValue('expiry', choice, {
              shouldDirty: true,
              shouldValidate: true,
            });
            // The calendar opens on a date a month out rather than empty.
            if (choice === 'custom' && expiryDate === null) {
              setValue(
                'expiryDate',
                dayjs(openedAt)
                  .startOf('day')
                  .add(DEFAULT_CUSTOM_EXPIRY_DAYS, 'day')
                  .valueOf(),
                { shouldDirty: true, shouldValidate: true },
              );
            }
          }}
          onCustomDateChange={(date) =>
            setValue('expiryDate', date, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            })
          }
          customDateError={formState.errors.expiryDate?.message}
        />
      </FormSection>
    </FormDialog>
  );
}
