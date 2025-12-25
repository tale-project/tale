'use client';

import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormModal } from '@/components/ui/modals';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { toast } from '@/hooks/use-toast';
import { useUpdateMemberRole } from '../hooks';
import { useT } from '@/lib/i18n';

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

export default function EditMemberDialog({
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
        displayName: z.string().min(1, tCommon('validation.required', { field: t('form.name') })),
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

  const handleUpdateMember = async (
    memberId: string,
    data: {
      displayName: string;
      role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
      email: string;
    },
  ) => {
    try {
      await updateMemberRole({
        memberId,
        role: data.role,
      });

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
    await handleUpdateMember(member._id, data);
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <FormModal
      open={open}
      onOpenChange={handleOpenChange}
      title={t('organization.editMember')}
      isSubmitting={isSubmitting}
      submitDisabled={!isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      {/* Name Field */}
      <div className="space-y-2">
        <Label htmlFor="displayName" className="text-sm font-medium">
          {t('form.name')}
        </Label>
        <Input
          id="displayName"
          placeholder={t('form.namePlaceholder')}
          {...register('displayName')}
          className="w-full"
          required
        />
      </div>

      {/* Email Field - Read-only */}
      <div className="space-y-2">
        <Label htmlFor="email" className="text-sm font-medium">
          {t('form.email')}
        </Label>
        <Input
          id="email"
          type="email"
          placeholder={t('form.emailPlaceholder')}
          {...register('email')}
          className="w-full bg-muted"
          disabled
          required
        />
        <p className="text-xs text-muted-foreground">
          {t('organization.emailCannotChange')}
        </p>
      </div>

      {/* Role Field */}
      <div className="space-y-2">
        <Label htmlFor="role" className="text-sm font-medium">
          {t('form.role')}
        </Label>
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              disabled={isEditingSelf}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t('roles.admin')}</SelectItem>
                <SelectItem value="developer">{t('roles.developer')}</SelectItem>
                <SelectItem value="editor">{t('roles.editor')}</SelectItem>
                <SelectItem value="member">{t('roles.member')}</SelectItem>
                <SelectItem value="disabled">{t('roles.disabled')}</SelectItem>
              </SelectContent>
            </Select>
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
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <p className="text-sm text-amber-800">
                {t('organization.adminWarning')}
              </p>
            </div>
          )}
      </div>

      {/* Password Update Section */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center space-x-2">
          <Controller
            control={form.control}
            name="updatePassword"
            render={({ field }) => (
              <Checkbox
                id="updatePassword"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Label
            htmlFor="updatePassword"
            className="text-sm font-medium cursor-pointer"
          >
            {t('organization.updatePassword')}
          </Label>
        </div>

        {watch('updatePassword') && (
          <div className="space-y-2">
            <Label htmlFor="password" className="text-sm font-medium">
              {t('form.password')}
            </Label>
            <Input
              id="password"
              type="password"
              placeholder={t('organization.enterNewPassword')}
              {...register('password')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {t('organization.userMustUpdatePassword')}
            </p>
          </div>
        )}
      </div>
    </FormModal>
  );
}
