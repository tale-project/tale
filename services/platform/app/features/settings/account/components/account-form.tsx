'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Field } from '@/app/components/ui/forms/field';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useHasCredentialAccount } from '@/app/features/auth/hooks/queries';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';

import { useUpdatePassword, useUpdateUserName } from '../hooks/mutations';

interface ProfileFormData {
  name: string;
}

interface ChangePasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface SetPasswordFormData {
  newPassword: string;
  confirmPassword: string;
}

export function AccountForm() {
  const { data: hasCredential, isLoading: isCredentialLoading } =
    useHasCredentialAccount();

  if (isCredentialLoading) {
    return null;
  }

  return (
    <Stack>
      <ProfileSection />
      <PasswordSection hasCredential={hasCredential ?? false} />
    </Stack>
  );
}

function ProfileSection() {
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { user } = useAuth();
  const { mutateAsync: updateUserName } = useUpdateUserName();
  const { toast } = useToast();

  const profileSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, tSettings('account.profile.nameRequired')),
      }),
    [tSettings],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name ?? '',
    },
  });

  useEffect(() => {
    if (user?.name) {
      reset({ name: user.name }, { keepDirty: false });
    }
  }, [user?.name, reset]);

  const onSubmit = async (data: ProfileFormData) => {
    const name = data.name.trim();
    try {
      await updateUserName({ name });
      toast({
        title: tToast('success.profileUpdated'),
        variant: 'success',
      });
      reset({ name });
    } catch {
      toast({
        title: tToast('error.profileUpdateFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <Form onSubmit={handleSubmit(onSubmit)} className="space-y-0">
        <HStack gap={3} align="end" justify="between">
          <Input
            id="display-name"
            label={tSettings('account.profile.name')}
            placeholder={tSettings('account.profile.namePlaceholder')}
            disabled={isSubmitting}
            errorMessage={errors.name?.message}
            wrapperClassName="max-w-sm flex-1"
            {...register('name')}
          />
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </HStack>
      </Form>

      <Field label={tSettings('account.profile.email')}>
        <Text variant="muted" as="span">
          {user?.email ?? ''}
        </Text>
      </Field>
    </>
  );
}

interface PasswordSectionProps {
  hasCredential: boolean;
}

function PasswordSection({ hasCredential }: PasswordSectionProps) {
  const { t: tAuth } = useT('auth');
  const { t: tSettings } = useT('settings');
  const [open, setOpen] = useState(false);

  return (
    <PageSection
      title={tSettings('account.security.title')}
      titleSize="base"
      className="pt-4"
    >
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {hasCredential
            ? tAuth('changePassword.title')
            : tAuth('setPassword.title')}
        </Button>
      </div>

      {hasCredential ? (
        <ChangePasswordDialog open={open} onOpenChange={setOpen} />
      ) : (
        <SetPasswordDialog open={open} onOpenChange={setOpen} />
      )}
    </PageSection>
  );
}

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ChangePasswordDialog({ open, onOpenChange }: PasswordDialogProps) {
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const { toast } = useToast();

  const changePasswordSchema = useMemo(
    () =>
      z
        .object({
          currentPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.currentRequired')),
          newPassword: createPasswordSchema({
            minLength: tAuth('validation.passwordMinLength'),
            lowercase: tAuth('validation.passwordLowercase'),
            uppercase: tAuth('validation.passwordUppercase'),
            number: tAuth('validation.passwordNumber'),
            specialChar: tAuth('validation.passwordSpecial'),
          }),
          confirmPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.confirmRequired')),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: tAuth('changePassword.validation.mismatch'),
          path: ['confirmPassword'],
        }),
    [tAuth],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    watch,
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
    mode: 'onChange',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');
  const passwordValidationItems = usePasswordValidation(newPassword);

  const onSubmit = async (data: ChangePasswordFormData) => {
    try {
      await updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      toast({
        title: tToast('success.passwordChanged'),
        variant: 'success',
      });

      reset();
      onOpenChange(false);
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
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
      title={tAuth('changePassword.title')}
      submitText={tAuth('changePassword.title')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="current-password"
        type="password"
        label={tAuth('changePassword.currentPassword')}
        placeholder={tAuth('changePassword.placeholder.current')}
        disabled={isSubmitting}
        errorMessage={errors.currentPassword?.message}
        {...register('currentPassword')}
      />

      <FormSection>
        <Input
          id="new-password"
          type="password"
          label={tAuth('changePassword.newPassword')}
          placeholder={tAuth('changePassword.placeholder.new')}
          disabled={isSubmitting}
          errorMessage={errors.newPassword?.message}
          {...register('newPassword')}
        />
        {newPassword && (
          <ValidationCheckList
            items={passwordValidationItems}
            className="text-xs"
          />
        )}
      </FormSection>

      <Input
        id="confirm-password"
        type="password"
        label={tAuth('changePassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
    </FormDialog>
  );
}

function SetPasswordDialog({ open, onOpenChange }: PasswordDialogProps) {
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const { toast } = useToast();

  const setPasswordSchema = useMemo(
    () =>
      z
        .object({
          newPassword: createPasswordSchema({
            minLength: tAuth('validation.passwordMinLength'),
            lowercase: tAuth('validation.passwordLowercase'),
            uppercase: tAuth('validation.passwordUppercase'),
            number: tAuth('validation.passwordNumber'),
            specialChar: tAuth('validation.passwordSpecial'),
          }),
          confirmPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.confirmRequired')),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: tAuth('changePassword.validation.mismatch'),
          path: ['confirmPassword'],
        }),
    [tAuth],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    watch,
  } = useForm<SetPasswordFormData>({
    resolver: zodResolver(setPasswordSchema),
    mode: 'onChange',
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');
  const passwordValidationItems = usePasswordValidation(newPassword);

  const onSubmit = async (data: SetPasswordFormData) => {
    try {
      await updatePassword({
        newPassword: data.newPassword,
      });

      toast({
        title: tToast('success.passwordSet'),
        variant: 'success',
      });

      reset();
      onOpenChange(false);
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
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
      title={tAuth('setPassword.title')}
      description={tAuth('setPassword.description')}
      submitText={tAuth('setPassword.title')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        <Input
          id="new-password"
          type="password"
          label={tAuth('setPassword.newPassword')}
          placeholder={tAuth('changePassword.placeholder.new')}
          disabled={isSubmitting}
          errorMessage={errors.newPassword?.message}
          {...register('newPassword')}
        />
        {newPassword && (
          <ValidationCheckList
            items={passwordValidationItems}
            className="text-xs"
          />
        )}
      </FormSection>

      <Input
        id="confirm-password"
        type="password"
        label={tAuth('setPassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
    </FormDialog>
  );
}
