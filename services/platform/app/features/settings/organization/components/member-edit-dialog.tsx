'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import * as z from 'zod';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Banner } from '@/app/components/ui/feedback/banner';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  memberRoleSchema,
  type MemberRole,
} from '@/lib/shared/schemas/organizations';
import { createOptionalPasswordSchema } from '@/lib/shared/schemas/password';

import {
  useResetMemberTwoFactor,
  useSetMemberPassword,
  useUpdateMemberDisplayName,
  useUpdateMemberRole,
} from '../hooks/mutations';
import { isMemberRole } from '../utils/role-guards';

type EditMemberFormData = {
  displayName: string;
  role: MemberRole;
  email: string;
  updatePassword?: boolean;
  password?: string;
};

type MemberLite = {
  _id: string;
  organizationId: string;
  displayName?: string;
  role?: string;
  email?: string;
};

interface EditMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberLite | null;
  currentUserMemberId?: string;
}

export function EditMemberDialog({
  open,
  onOpenChange,
  member,
  currentUserMemberId,
}: EditMemberDialogProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tAuth } = useT('auth');

  const policy = usePasswordPolicy(member?.organizationId);

  const editMemberSchema = useMemo(
    () =>
      z.object({
        displayName: z
          .string()
          .min(1, tCommon('validation.required', { field: t('form.name') })),
        role: memberRoleSchema,
        email: z.string().email(tCommon('validation.email')),
        updatePassword: z.boolean().optional(),
        password: createOptionalPasswordSchema(
          {
            minLength: tAuth('validation.passwordMinLength', {
              n: policy.minLength,
            }),
            lowercase: tAuth('validation.passwordLowercase'),
            uppercase: tAuth('validation.passwordUppercase'),
            number: tAuth('validation.passwordNumber'),
            specialChar: tAuth('validation.passwordSpecial'),
          },
          policy,
        ),
      }),
    [t, tCommon, tAuth, policy],
  );

  const form = useForm<EditMemberFormData>({
    resolver: zodResolver(editMemberSchema),
    mode: 'onChange',
    defaultValues: {
      displayName: member?.displayName,
      role: isMemberRole(member?.role) ? member.role : undefined,
      email: member?.email,
      updatePassword: false,
      password: '',
    },
  });

  const { mutateAsync: updateMemberRole } = useUpdateMemberRole();
  const { mutateAsync: updateMemberDisplayName } = useUpdateMemberDisplayName();
  const { mutateAsync: setMemberPassword } = useSetMemberPassword();
  const { mutateAsync: resetMemberTwoFactor } = useResetMemberTwoFactor();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleUpdateMember = async (
    memberId: string,
    data: EditMemberFormData,
    original: { role?: string; displayName?: string },
  ) => {
    try {
      const promises: Promise<unknown>[] = [];

      const roleChanged =
        data.role.toLowerCase() !== original.role?.toLowerCase();
      if (roleChanged) {
        promises.push(updateMemberRole({ memberId, role: data.role }));
      }

      const displayNameChanged = data.displayName !== original.displayName;
      if (displayNameChanged) {
        promises.push(
          updateMemberDisplayName({ memberId, displayName: data.displayName }),
        );
      }

      if (data.updatePassword && data.password) {
        promises.push(
          setMemberPassword({ memberId, newPassword: data.password }),
        );
      }

      if (promises.length > 0) {
        await Promise.all(promises);

        toast({
          title: t('organization.memberUpdated'),
          variant: 'success',
        });
      }
    } catch (error) {
      console.error(error);
      toast({
        title: t('organization.memberUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  const { handleSubmit, register, reset, watch, formState } = form;
  const { isSubmitting, isDirty, isValid } = formState;
  const password = watch('password') ?? '';
  const passwordValidationItems = usePasswordValidation(password, policy);

  const isEditingSelf = currentUserMemberId === member?._id;

  const onSubmit = async (data: EditMemberFormData) => {
    if (!member) return;
    await handleUpdateMember(member._id, data, {
      role: member.role,
      displayName: member.displayName,
    });
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('organization.editMember')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      {/* Name Field */}
      <Input
        id="displayName"
        label={t('form.name')}
        placeholder={t('form.namePlaceholder')}
        {...register('displayName')}
        className="w-full"
        required
      />

      {/* Email Field - Read-only */}
      <FormSection>
        <Input
          id="email"
          type="email"
          label={t('form.email')}
          placeholder={t('form.emailPlaceholder')}
          {...register('email')}
          className="bg-muted w-full"
          disabled
          required
        />
        <Text variant="caption">{t('organization.emailCannotChange')}</Text>
      </FormSection>

      {/* Role Field */}
      <FormSection>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={isEditingSelf}
              label={t('form.role')}
              options={[
                { value: 'admin', label: t('roles.admin') },
                { value: 'developer', label: t('roles.developer') },
                { value: 'editor', label: t('roles.editor') },
                { value: 'member', label: t('roles.member') },
                { value: 'disabled', label: t('roles.disabled') },
              ]}
            />
          )}
        />
        {isEditingSelf && (
          <Text variant="muted">{t('organization.cannotChangeOwnRole')}</Text>
        )}
        {!isEditingSelf &&
          isMemberRole(member?.role) &&
          member.role === 'admin' &&
          watch('role') !== 'admin' && (
            <Banner
              variant="warning"
              message={t('organization.adminWarning')}
              dismissible={false}
              className="mt-2"
            />
          )}
      </FormSection>

      {/* Password Update Section */}
      <FormSection className="border-t pt-4">
        <Controller
          control={form.control}
          name="updatePassword"
          render={({ field }) => (
            <Checkbox
              id="updatePassword"
              checked={field.value}
              onCheckedChange={(checked) => {
                field.onChange(checked);
                if (!checked) {
                  form.resetField('password');
                }
              }}
              label={t('organization.updatePassword')}
            />
          )}
        />

        {watch('updatePassword') && (
          <FormSection>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              label={t('form.password')}
              placeholder={t('organization.enterNewPassword')}
              {...register('password')}
              className="w-full"
            />
            {password && (
              <ValidationCheckList
                items={passwordValidationItems}
                className="text-xs"
              />
            )}
            <Text variant="caption">
              {t('organization.userMustUpdatePassword')}
            </Text>
          </FormSection>
        )}
      </FormSection>

      {!isEditingSelf && member && (
        <TwoFactorResetControl
          memberId={member._id}
          memberName={member.displayName ?? member.email ?? ''}
          open={resetOpen}
          onOpenChange={setResetOpen}
          resetting={resetting}
          onReset={async () => {
            if (!member) return;
            setResetting(true);
            try {
              await resetMemberTwoFactor({ memberId: member._id });
              toast({
                title: t('organization.twoFactorResetSuccess'),
                variant: 'success',
              });
              setResetOpen(false);
            } catch {
              toast({
                title: t('organization.twoFactorResetFailed'),
                variant: 'destructive',
              });
            } finally {
              setResetting(false);
            }
          }}
        />
      )}
    </FormDialog>
  );
}

interface TwoFactorResetControlProps {
  memberId: string;
  memberName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resetting: boolean;
  onReset: () => void;
}

function TwoFactorResetControl({
  memberName,
  open,
  onOpenChange,
  resetting,
  onReset,
}: TwoFactorResetControlProps) {
  const { t } = useT('twoFactor');
  return (
    <FormSection className="border-t pt-4">
      <Text variant="caption" className="mb-2">
        {t('enrollment.title')}
      </Text>
      <Button
        type="button"
        variant="secondary"
        onClick={() => onOpenChange(true)}
      >
        {t('admin.resetButton')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('admin.confirmTitle')}
        description={t('admin.confirmDescription', { name: memberName })}
        confirmText={t('admin.resetButton')}
        variant="destructive"
        isLoading={resetting}
        onConfirm={onReset}
      />
    </FormSection>
  );
}
