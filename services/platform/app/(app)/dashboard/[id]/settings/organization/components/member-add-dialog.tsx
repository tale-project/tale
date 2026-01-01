'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormDialog, ViewDialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ValidationCheckList } from '@/components/ui/validation-check-item';
import { CopyableField } from '@/components/ui/copyable-field';
import { useAddMember } from '../hooks/use-add-member';
import { useCreateMember } from '../hooks/use-create-member';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n';

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
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const { toast } = useToast();

  const addMember = useAddMember();
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
    [password, tAuth]
  );

  const onSubmit = async (data: AddMemberFormData) => {
    setIsSubmitting(true);
    try {
      let userId: string | undefined;
      let isNewUser = false;

      // First, check if user already exists
      // Derive Convex URL from current origin (routes through Next.js proxy)
      const convexUrl = `${window.location.origin}/ws_api`;
      const client = new ConvexHttpClient(convexUrl);

      const existingUserId = await client.query(api.member.getUserIdByEmail, {
        email: data.email,
      });

      if (existingUserId) {
        // User already exists - just add them to the organization
        userId = existingUserId;
        isNewUser = false;

        // Add existing user to organization
        await addMember({
          organizationId: organizationId as string,
          email: data.email,
          userId: userId as string,
          role: data.role,
          displayName: data.displayName,
        });
      } else {
        // User doesn't exist - create new account SERVER-SIDE
        // This won't affect the admin's session!
        if (!data.password || data.password.length === 0) {
          throw new Error(tDialogs('addMember.passwordRequiredForNewUser'));
        }

        // Use server-side mutation that creates user WITHOUT creating a session
        // This keeps the admin logged in!
        await createMember({
          organizationId: organizationId as string,
          email: data.email,
          password: data.password,
          displayName: data.displayName,
          role: data.role,
        });

        isNewUser = true;

        // Store credentials for display
        setCredentials({
          email: data.email,
          password: data.password,
        });
      }

      // Success! Show credentials dialog only for new users
      toast({
        title: isNewUser
          ? tToast('success.newMemberCreated')
          : tToast('success.existingUserAdded'),
        variant: 'success',
      });

      if (isNewUser && data.password) {
        // Only show credentials for newly created accounts
        setCredentials({
          email: data.email,
          password: data.password,
        });
        setShowCredentials(true);
      } else {
        // For existing users, just close the dialog
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
              value as
                | 'disabled'
                | 'admin'
                | 'developer'
                | 'editor'
                | 'member',
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
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
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

          <Button onClick={handleClose} className="w-full">
            {tCommon('actions.done')}
          </Button>
        </Stack>
      </ViewDialog>
    </>
  );
}
