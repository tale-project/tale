'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { FormModal, ViewModal } from '@/components/ui/modals';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stack, HStack } from '@/components/ui/layout';
import { Select } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Check, X, Copy } from 'lucide-react';
import { useAddMember, useCreateMember } from '../hooks';
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

export default function AddMemberDialog({
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
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
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

  // Password validation checks
  const passwordChecks = {
    length: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /\d/.test(password),
  };

  const handleCopy = async (text: string, type: 'email' | 'password') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'email') {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      } else {
        setCopiedPassword(true);
        setTimeout(() => setCopiedPassword(false), 2000);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: tCommon('errors.failedToCopy'),
        variant: 'destructive',
      });
    }
  };

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

      // Success! Show credentials modal only for new users
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
    setCopiedEmail(false);
    setCopiedPassword(false);
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
      {/* Add Member Form Dialog */}
      <FormModal
        open={open && !showCredentials}
        onOpenChange={handleOpenChange}
        title={tDialogs('addMember.title')}
        submitText={tDialogs('addMember.title')}
        submittingText={tCommon('actions.adding')}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit(onSubmit)}
      >
        {/* Name Field */}
        <Input
          id="displayName"
          label={tSettings('form.name')}
          placeholder={tSettings('form.namePlaceholder')}
          {...register('displayName')}
          className="w-full"
        />

        {/* Email Field */}
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

        {/* Password Field */}
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
            <Stack gap={1} className="text-xs">
              <HStack gap={1}>
                {passwordChecks.length ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={
                    passwordChecks.length
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {tAuth('changePassword.requirements.length')}
                </span>
              </HStack>
              <HStack gap={1}>
                {passwordChecks.lowercase ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={
                    passwordChecks.lowercase
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {tAuth('changePassword.requirements.lowercase')}
                </span>
              </HStack>
              <HStack gap={1}>
                {passwordChecks.uppercase ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={
                    passwordChecks.uppercase
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {tAuth('changePassword.requirements.uppercase')}
                </span>
              </HStack>
              <HStack gap={1}>
                {passwordChecks.number ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span
                  className={
                    passwordChecks.number
                      ? 'text-green-600'
                      : 'text-muted-foreground'
                  }
                >
                  {tAuth('changePassword.requirements.number')}
                </span>
              </HStack>
            </Stack>
          )}
        </Stack>

        {/* Role Field */}
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
      </FormModal>

      {/* Credentials Display Dialog */}
      <ViewModal
        open={showCredentials}
        onOpenChange={handleClose}
        title={tDialogs('memberAdded.title')}
      >
        <Stack gap={4}>
          <div className="rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 border border-yellow-200">
            {tDialogs('memberAdded.credentialsWarning')}
          </div>

          {credentials && (
            <Stack gap={4}>
              {/* Email */}
              <HStack gap={2}>
                <Input
                  value={credentials.email}
                  readOnly
                  label={tSettings('form.email')}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 mt-6"
                  onClick={() => handleCopy(credentials.email, 'email')}
                >
                  {copiedEmail ? (
                    <Check className="size-4 text-success p-0.5" />
                  ) : (
                    <Copy className="size-4 p-0.5" />
                  )}
                </Button>
              </HStack>

              {/* Password */}
              <HStack gap={2}>
                <Input
                  value={credentials.password}
                  readOnly
                  label={tSettings('form.password')}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 mt-6"
                  onClick={() =>
                    handleCopy(credentials.password, 'password')
                  }
                >
                  {copiedPassword ? (
                    <Check className="size-4 text-success p-0.5" />
                  ) : (
                    <Copy className="size-4 p-0.5" />
                  )}
                </Button>
              </HStack>
            </Stack>
          )}

          <Button onClick={handleClose} className="w-full">
            {tCommon('actions.done')}
          </Button>
        </Stack>
      </ViewModal>
    </>
  );
}
