'use client';

import { useForm } from 'react-hook-form';
import { useMutation, usePreloadedQuery, type Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useT } from '@/lib/i18n';

interface AccountFormProps {
  organizationId: string;
  preloadedMemberContext: Preloaded<typeof api.member.getCurrentMemberContext>;
}

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function AccountForm({
  preloadedMemberContext,
}: AccountFormProps) {
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const memberContext = usePreloadedQuery(preloadedMemberContext);
  const updatePassword = useMutation(api.users.updateUserPassword);
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
      <div className="flex justify-center py-6">
        <div className="w-full max-w-md text-sm text-muted-foreground">
          {tAuth('changePassword.ssoMessage')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center py-6">
      <div className="w-full max-w-md">
        <h2 className="text-lg font-semibold mb-6">{tAuth('changePassword.title')}</h2>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password">{tAuth('changePassword.currentPassword')}</Label>
            <Input
              id="current-password"
              type="password"
              placeholder={tAuth('changePassword.placeholder.current')}
              disabled={isSubmitting}
              errorMessage={errors.currentPassword?.message}
              {...register('currentPassword', {
                required: tAuth('changePassword.validation.currentRequired'),
              })}
            />
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">{tAuth('changePassword.newPassword')}</Label>
            <Input
              id="new-password"
              type="password"
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
          </div>

          {/* Confirm New Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{tAuth('changePassword.confirmPassword')}</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder={tAuth('changePassword.placeholder.confirm')}
              disabled={isSubmitting}
              errorMessage={errors.confirmPassword?.message}
              {...register('confirmPassword', {
                required: tAuth('changePassword.validation.confirmRequired'),
                validate: (value) =>
                  value === newPassword || tAuth('changePassword.validation.mismatch'),
              })}
            />
          </div>

          {/* Submit Button */}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
          </Button>
        </form>
      </div>
    </div>
  );
}

