'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Banner } from '@/app/components/ui/feedback/banner';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  memberRoleSchema,
  type MemberRole,
} from '@/lib/shared/schemas/organizations';

import {
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

  const editMemberSchema = useMemo(
    () =>
      z.object({
        displayName: z
          .string()
          .min(1, tCommon('validation.required', { field: t('form.name') })),
        role: memberRoleSchema,
        email: z.string().email(tCommon('validation.email')),
        updatePassword: z.boolean().optional(),
        password: z.string().optional(),
      }),
    [t, tCommon],
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
  const { isSubmitting, isValid, isDirty } = formState;

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
      isValid={isValid && isDirty}
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
              onCheckedChange={field.onChange}
              label={t('organization.updatePassword')}
            />
          )}
        />

        {watch('updatePassword') && (
          <FormSection>
            <Input
              id="password"
              type="password"
              label={t('form.password')}
              placeholder={t('organization.enterNewPassword')}
              {...register('password')}
              className="w-full"
            />
            <Text variant="caption">
              {t('organization.userMustUpdatePassword')}
            </Text>
          </FormSection>
        )}
      </FormSection>
    </FormDialog>
  );
}
