'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { NarrowContainer } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Button } from '@/app/components/ui/primitives/button';
import { useHasCredentialAccount } from '@/app/features/auth/hooks/queries';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';

import { useUpdatePassword } from '../hooks/mutations';

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
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const { toast } = useToast();

  const { data: hasCredential, isLoading: isCredentialLoading } =
    useHasCredentialAccount();

  if (isCredentialLoading) {
    return null;
  }

  if (hasCredential) {
    return (
      <NarrowContainer className="p-0!">
        <PageSection
          title={tAuth('changePassword.title')}
          titleSize="lg"
          gap={6}
        >
          <ChangePasswordForm
            updatePassword={updatePassword}
            toast={toast}
            tAuth={tAuth}
            tCommon={tCommon}
            tToast={tToast}
          />
        </PageSection>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="p-0!">
      <PageSection
        title={tAuth('setPassword.title')}
        description={tAuth('setPassword.description')}
        titleSize="lg"
        gap={6}
      >
        <SetPasswordForm
          updatePassword={updatePassword}
          toast={toast}
          tAuth={tAuth}
          tCommon={tCommon}
          tToast={tToast}
        />
      </PageSection>
    </NarrowContainer>
  );
}

function ChangePasswordForm({
  updatePassword,
  toast,
  tAuth,
  tCommon,
  tToast,
}: {
  updatePassword: ReturnType<typeof useUpdatePassword>['mutateAsync'];
  toast: ReturnType<typeof useToast>['toast'];
  tAuth: ReturnType<typeof useT>['t'];
  tCommon: ReturnType<typeof useT>['t'];
  tToast: ReturnType<typeof useT>['t'];
}) {
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
    formState: { errors, isSubmitting },
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
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
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

      <Button type="submit" disabled={isSubmitting} fullWidth>
        {isSubmitting
          ? tCommon('actions.saving')
          : tCommon('actions.saveChanges')}
      </Button>
    </Form>
  );
}

function SetPasswordForm({
  updatePassword,
  toast,
  tAuth,
  tCommon,
  tToast,
}: {
  updatePassword: ReturnType<typeof useUpdatePassword>['mutateAsync'];
  toast: ReturnType<typeof useToast>['toast'];
  tAuth: ReturnType<typeof useT>['t'];
  tCommon: ReturnType<typeof useT>['t'];
  tToast: ReturnType<typeof useT>['t'];
}) {
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
    formState: { errors, isSubmitting },
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
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
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

      <Button type="submit" disabled={isSubmitting} fullWidth>
        {isSubmitting ? tCommon('actions.saving') : tAuth('setPassword.title')}
      </Button>
    </Form>
  );
}
