'use client';

import { useForm } from 'react-hook-form';
import { useUpdatePassword } from '../hooks/use-update-password';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Form } from '@/app/components/ui/forms/form';
import { Stack, NarrowContainer } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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

interface PasswordFormData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function AccountFormClient({
  memberContext,
}: AccountFormClientProps) {
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
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

      reset();
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <NarrowContainer className="p-0!">
      <Stack>
        <h2 className="text-lg font-semibold mb-6">
          {tAuth('changePassword.title')}
        </h2>
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
      </Stack>
    </NarrowContainer>
  );
}
