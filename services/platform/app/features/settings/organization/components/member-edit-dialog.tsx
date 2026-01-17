'use client';

import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Stack } from '@/app/components/ui/layout/layout';
import { Select } from '@/app/components/ui/forms/select';
import { Banner } from '@/app/components/ui/feedback/banner';
import { toast } from '@/app/hooks/use-toast';
import { useUpdateMemberRole } from '../hooks/use-update-member-role';
import { useUpdateMemberDisplayName } from '../hooks/use-update-member-display-name';
import { useT } from '@/lib/i18n/client';

// Type for the form data
type EditMemberFormData = {
  displayName: string;
  role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
  email: string;
  updatePassword?: boolean;
  password?: string;
};

type MemberLite = {
  _id: string;
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

  // Create Zod schema with translated validation messages
  const editMemberSchema = useMemo(
    () =>
      z.object({
        displayName: z
          .string()
          .min(1, tCommon('validation.required', { field: t('form.name') })),
        role: z.enum(['disabled', 'admin', 'developer', 'editor', 'member']),
        email: z.string().email(tCommon('validation.email')),
        updatePassword: z.boolean().optional(),
        password: z.string().optional(),
      }),
    [t, tCommon],
  );

  const form = useForm<EditMemberFormData>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: {
      displayName: member?.displayName,
      role: member?.role as any as
        | 'disabled'
        | 'admin'
        | 'developer'
        | 'editor'
        | 'member'
        | undefined,
      email: member?.email,
      updatePassword: false,
      password: '',
    },
  });

  const updateMemberRole = useUpdateMemberRole();
  const updateMemberDisplayName = useUpdateMemberDisplayName();

  const handleUpdateMember = async (
    memberId: string,
    data: {
      displayName: string;
      role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
      email: string;
    },
    original: { role?: string; displayName?: string },
  ) => {
    try {
      const promises: Promise<unknown>[] = [];

      // Only call updateMemberRole if role actually changed
      const roleChanged =
        data.role.toLowerCase() !== original.role?.toLowerCase();
      if (roleChanged) {
        promises.push(updateMemberRole({ memberId, role: data.role }));
      }

      // Only call updateMemberDisplayName if displayName actually changed
      const displayNameChanged = data.displayName !== original.displayName;
      if (displayNameChanged) {
        promises.push(
          updateMemberDisplayName({ memberId, displayName: data.displayName }),
        );
      }

      await Promise.all(promises);

      toast({
        title: t('organization.memberUpdated'),
        variant: 'success',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: t('organization.memberUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  const { handleSubmit, register, reset, watch, formState } = form;
  const { isSubmitting, isDirty } = formState;

  const isEditingSelf = currentUserMemberId === member?._id;

  const onSubmit = async (data: EditMemberFormData) => {
    if (!member) return;
    await handleUpdateMember(member._id, data, {
      role: member.role,
      displayName: member.displayName,
    });
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('organization.editMember')}
      isSubmitting={isSubmitting}
      submitDisabled={!isDirty}
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
      <Stack gap={2}>
        <Input
          id="email"
          type="email"
          label={t('form.email')}
          placeholder={t('form.emailPlaceholder')}
          {...register('email')}
          className="w-full bg-muted"
          disabled
          required
        />
        <p className="text-xs text-muted-foreground">
          {t('organization.emailCannotChange')}
        </p>
      </Stack>

      {/* Role Field */}
      <Stack gap={2}>
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
          <p className="text-sm text-muted-foreground">
            {t('organization.cannotChangeOwnRole')}
          </p>
        )}
        {!isEditingSelf &&
          member?.role === 'admin' &&
          watch('role') !== 'admin' && (
            <Banner
              variant="warning"
              message={t('organization.adminWarning')}
              dismissible={false}
              className="mt-2"
            />
          )}
      </Stack>

      {/* Password Update Section */}
      <Stack gap={4} className="pt-4 border-t">
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
          <Stack gap={2}>
            <Input
              id="password"
              type="password"
              label={t('form.password')}
              placeholder={t('organization.enterNewPassword')}
              {...register('password')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {t('organization.userMustUpdatePassword')}
            </p>
          </Stack>
        )}
      </Stack>
    </FormDialog>
  );
}
