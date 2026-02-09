'use client';

import { useQuery } from 'convex/react';
import { useForm } from 'react-hook-form';

import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useUpdatePassword } from '../hooks/use-update-password';

interface MemberContext {
  memberId: string;
  organizationId: string;
  userId: string;
  role: 'admin' | 'member' | 'editor' | 'developer' | 'disabled';
  createdAt: number;
  displayName?: string;
  isAdmin: boolean;
}

interface AccountFormClientProps {
  organizationId: string;
  memberContext: MemberContext | null;
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

export function AccountFormClient({
  memberContext: _memberContext,
}: AccountFormClientProps) {
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const updatePassword = useUpdatePassword();
  const { toast } = useToast();

  const hasCredential = useQuery(api.accounts.queries.hasCredentialAccount);

  if (hasCredential === undefined) {
    return null;
  }

  if (hasCredential) {
    return (
      <NarrowContainer className="p-0!">
        <Stack>
          <h2 className="mb-6 text-lg font-semibold">
            {tAuth('changePassword.title')}
          </h2>
          <ChangePasswordForm
            updatePassword={updatePassword}
            toast={toast}
            tAuth={tAuth}
            tCommon={tCommon}
            tToast={tToast}
          />
        </Stack>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="p-0!">
      <Stack>
        <h2 className="mb-6 text-lg font-semibold">
          {tAuth('setPassword.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {tAuth('setPassword.description')}
        </p>
        <SetPasswordForm
          updatePassword={updatePassword}
          toast={toast}
          tAuth={tAuth}
          tCommon={tCommon}
          tToast={tToast}
        />
      </Stack>
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
  updatePassword: ReturnType<typeof useUpdatePassword>;
  toast: ReturnType<typeof useToast>['toast'];
  tAuth: ReturnType<typeof useT>['t'];
  tCommon: ReturnType<typeof useT>['t'];
  tToast: ReturnType<typeof useT>['t'];
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<ChangePasswordFormData>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');

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
        {...register('currentPassword', {
          required: tAuth('changePassword.validation.currentRequired'),
        })}
      />

      <Input
        id="new-password"
        type="password"
        label={tAuth('changePassword.newPassword')}
        placeholder={tAuth('changePassword.placeholder.new')}
        disabled={isSubmitting}
        errorMessage={errors.newPassword?.message}
        {...register('newPassword', {
          required: tAuth('changePassword.validation.newRequired'),
          minLength: {
            value: 8,
            message: tAuth('changePassword.validation.minLength'),
          },
        })}
      />

      <Input
        id="confirm-password"
        type="password"
        label={tAuth('changePassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword', {
          required: tAuth('changePassword.validation.confirmRequired'),
          validate: (value) =>
            value === newPassword ||
            tAuth('changePassword.validation.mismatch'),
        })}
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
  updatePassword: ReturnType<typeof useUpdatePassword>;
  toast: ReturnType<typeof useToast>['toast'];
  tAuth: ReturnType<typeof useT>['t'];
  tCommon: ReturnType<typeof useT>['t'];
  tToast: ReturnType<typeof useT>['t'];
}) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<SetPasswordFormData>({
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');

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
      <Input
        id="new-password"
        type="password"
        label={tAuth('setPassword.newPassword')}
        placeholder={tAuth('changePassword.placeholder.new')}
        disabled={isSubmitting}
        errorMessage={errors.newPassword?.message}
        {...register('newPassword', {
          required: tAuth('changePassword.validation.newRequired'),
          minLength: {
            value: 8,
            message: tAuth('changePassword.validation.minLength'),
          },
        })}
      />

      <Input
        id="confirm-password"
        type="password"
        label={tAuth('setPassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword', {
          required: tAuth('changePassword.validation.confirmRequired'),
          validate: (value) =>
            value === newPassword ||
            tAuth('changePassword.validation.mismatch'),
        })}
      />

      <Button type="submit" disabled={isSubmitting} fullWidth>
        {isSubmitting ? tCommon('actions.saving') : tAuth('setPassword.title')}
      </Button>
    </Form>
  );
}
