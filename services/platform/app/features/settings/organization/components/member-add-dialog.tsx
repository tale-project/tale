'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import { useCreateMember } from '../hooks/use-create-member';

// Type for the form data
type AddMemberFormData = {
  email: string;
  password?: string;
  displayName?: string;
  role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
};

interface AddMemberDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberDialog({
  organizationId,
  open,
  onOpenChange,
}: AddMemberDialogProps) {
  const { t: tDialogs } = useT('dialogs');
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');

  // Create Zod schema with translated validation messages
  const addMemberSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(tCommon('validation.email')),
        password: z
          .string()
          .optional()
          .refine(
            (val) => {
              // If password is provided, it must meet requirements
              if (!val || val.length === 0) return true;
              return (
                val.length >= 8 &&
                /[a-z]/.test(val) &&
                /[A-Z]/.test(val) &&
                /\d/.test(val)
              );
            },
            {
              message: tAuth('validation.passwordRequirements'),
            },
          ),
        displayName: z.string().optional(),
        role: z.enum(['disabled', 'admin', 'developer', 'editor', 'member']),
      }),
    [tCommon, tAuth],
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const { toast } = useToast();

  const createMember = useCreateMember();
  const form = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      role: 'member',
    },
  });

  const { handleSubmit, register, reset, setValue, watch, formState } = form;
  const selectedRole = watch('role');
  const password = watch('password') ?? '';

  // Password validation checks for display
  const passwordValidationItems = useMemo(
    () => [
      {
        isValid: password.length >= 8,
        message: tAuth('changePassword.requirements.length'),
      },
      {
        isValid: /[a-z]/.test(password),
        message: tAuth('changePassword.requirements.lowercase'),
      },
      {
        isValid: /[A-Z]/.test(password),
        message: tAuth('changePassword.requirements.uppercase'),
      },
      {
        isValid: /\d/.test(password),
        message: tAuth('changePassword.requirements.number'),
      },
    ],
    [password, tAuth],
  );

  const onSubmit = async (data: AddMemberFormData) => {
    setIsSubmitting(true);
    try {
      const result = await createMember({
        organizationId,
        email: data.email,
        password: data.password || undefined,
        displayName: data.displayName,
        role: data.role,
      });

      toast({
        title: result.isExistingUser
          ? tToast('success.existingUserAdded')
          : tToast('success.newMemberCreated'),
        variant: 'success',
      });

      if (result.isExistingUser) {
        setIsExistingUser(true);
        setShowCredentials(true);
      } else if (data.password) {
        setIsExistingUser(false);
        setCredentials({ email: data.email, password: data.password });
        setShowCredentials(true);
      } else {
        reset();
        setIsSubmitting(false);
        onOpenChange(false);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: tToast('error.addMemberFailed'),
        variant: 'destructive',
      });
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setShowCredentials(false);
    setIsExistingUser(false);
    setCredentials(null);
    reset();
    setIsSubmitting(false);
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !showCredentials) {
      reset();
    }
    onOpenChange(open);
  };

  return (
    <>
      <FormDialog
        open={open && !showCredentials}
        onOpenChange={handleOpenChange}
        title={tDialogs('addMember.title')}
        submitText={tDialogs('addMember.title')}
        submittingText={tCommon('actions.adding')}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit(onSubmit)}
      >
        <Input
          id="displayName"
          label={tSettings('form.name')}
          placeholder={tSettings('form.namePlaceholder')}
          {...register('displayName')}
          className="w-full"
        />

        <Input
          id="email"
          type="email"
          label={tSettings('form.email')}
          placeholder={tSettings('form.emailPlaceholder')}
          {...register('email')}
          className="w-full"
          required
          errorMessage={formState.errors.email?.message}
        />

        <Stack gap={2}>
          <Input
            id="password"
            type="password"
            label={tSettings('form.password')}
            placeholder={tSettings('form.passwordPlaceholder')}
            {...register('password')}
            className="w-full"
          />
          {password && (
            <ValidationCheckList
              items={passwordValidationItems}
              className="text-xs"
            />
          )}
        </Stack>

        <Select
          value={selectedRole}
          onValueChange={(value) =>
            setValue(
              'role',
              value as 'disabled' | 'admin' | 'developer' | 'editor' | 'member',
            )
          }
          label={tSettings('form.role')}
          options={[
            { value: 'admin', label: tSettings('roles.admin') },
            { value: 'developer', label: tSettings('roles.developer') },
            { value: 'editor', label: tSettings('roles.editor') },
            { value: 'member', label: tSettings('roles.member') },
            { value: 'disabled', label: tSettings('roles.disabled') },
          ]}
        />
      </FormDialog>

      <ViewDialog
        open={showCredentials}
        onOpenChange={handleClose}
        title={tDialogs('memberAdded.title')}
      >
        <Stack gap={4}>
          {isExistingUser ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
              {tDialogs('memberAdded.existingUserNotice')}
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
                {tDialogs('memberAdded.credentialsWarning')}
              </div>

              {credentials && (
                <Stack gap={4}>
                  <CopyableField
                    value={credentials.email}
                    label={tSettings('form.email')}
                  />
                  <CopyableField
                    value={credentials.password}
                    label={tSettings('form.password')}
                  />
                </Stack>
              )}
            </>
          )}

          <Button onClick={handleClose} fullWidth>
            {tCommon('actions.done')}
          </Button>
        </Stack>
      </ViewDialog>
    </>
  );
}
