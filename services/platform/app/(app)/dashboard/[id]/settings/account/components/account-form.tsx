'use client';

import { useForm } from 'react-hook-form';
import { usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useUpdatePassword } from '../hooks/use-update-password';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/forms/input';
import { Form } from '@/components/ui/forms/form';
import { Stack, NarrowContainer } from '@/components/ui/layout/layout';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

interface AccountFormProps {
  organizationId: string;
  preloadedMemberContext: Preloaded<typeof api.member.getCurrentMemberContext>;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function AccountForm({ preloadedMemberContext }: AccountFormProps) {
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const memberContext = usePreloadedQuery(preloadedMemberContext);
  const updatePassword = useUpdatePassword();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<PasswordFormData>({
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const newPassword = watch('newPassword');

  const onSubmit = async (data: PasswordFormData) => {
    try {
      await updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      toast({
        title: tToast('success.passwordChanged'),
        variant: 'success',
      });

      // Clear form
      reset();
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  if (memberContext && !memberContext.canChangePassword) {
    return (
      <NarrowContainer className="py-4">
        <div className="text-sm text-muted-foreground">
          {tAuth('changePassword.ssoMessage')}
        </div>
      </NarrowContainer>
    );
  }

  return (
    <NarrowContainer className="p-0!">
      <Stack>
        <h2 className="text-lg font-semibold mb-6">
          {tAuth('changePassword.title')}
        </h2>
        <Form onSubmit={handleSubmit(onSubmit)}>
          {/* Current Password */}
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

          {/* New Password */}
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

          {/* Confirm New Password */}
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

          {/* Submit Button */}
          <Button type="submit" disabled={isSubmitting} fullWidth>
            {isSubmitting
              ? tCommon('actions.saving')
              : tCommon('actions.saveChanges')}
          </Button>
        </Form>
      </Stack>
    </NarrowContainer>
  );
}
