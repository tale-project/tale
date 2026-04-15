import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { AuthFormLayout } from '@/app/features/auth/components/auth-form-layout';
import { useUpdatePassword } from '@/app/features/settings/account/hooks/mutations';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';

export const Route = createFileRoute('/dashboard/$id/forced-change-password')({
  component: ForcedChangePasswordPage,
});

type ForcedChangeFormData = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

function ForcedChangePasswordPage() {
  const { id: organizationId } = Route.useParams();
  const navigate = useNavigate();
  const { t: tAuth } = useT('auth');
  const { t: tCommon } = useT('common');
  const { t: tToast } = useT('toast');
  const { toast } = useToast();
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const policy = usePasswordPolicy(organizationId);

  // Users without a credential account can't be subject to rotation —
  // bounce them home if they somehow land here.
  const { data: expiryStatus } = useConvexQuery(
    api.users.queries.getPasswordExpiryStatus,
  );
  useEffect(() => {
    if (!expiryStatus) return;
    if (!expiryStatus.hasCredential || !expiryStatus.expired) {
      void navigate({
        to: '/dashboard/$id',
        params: { id: organizationId },
        replace: true,
      });
    }
  }, [expiryStatus, navigate, organizationId]);

  const schema = useMemo(
    () =>
      z
        .object({
          currentPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.currentRequired')),
          newPassword: createPasswordSchema(
            {
              minLength: tAuth('validation.passwordMinLength', {
                n: policy.minLength,
              }),
              lowercase: tAuth('validation.passwordLowercase'),
              uppercase: tAuth('validation.passwordUppercase'),
              number: tAuth('validation.passwordNumber'),
              specialChar: tAuth('validation.passwordSpecial'),
            },
            policy,
          ),
          confirmPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.confirmRequired')),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: tAuth('changePassword.validation.mismatch'),
          path: ['confirmPassword'],
        }),
    [tAuth, policy],
  );

  const form = useForm<ForcedChangeFormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });

  const { register, handleSubmit, formState, watch } = form;
  const { errors, isSubmitting, isValid } = formState;
  const newPassword = watch('newPassword');
  const validationItems = usePasswordValidation(newPassword, policy);

  const onSubmit = async (data: ForcedChangeFormData) => {
    try {
      await updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        trigger: 'forced',
      });
      toast({
        title: tToast('success.passwordChanged'),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id',
        params: { id: organizationId },
        replace: true,
      });
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <AuthFormLayout title={tAuth('forcedChange.title')}>
      <Stack gap={6}>
        <Text variant="muted" className="text-sm">
          {tAuth('forcedChange.description')}
        </Text>
        <FormSection>
          <Form onSubmit={handleSubmit(onSubmit)} autoComplete="on">
            <Input
              id="current-password"
              type="password"
              size="lg"
              autoComplete="current-password"
              label={tAuth('changePassword.currentPassword')}
              placeholder={tAuth('changePassword.placeholder.current')}
              disabled={isSubmitting}
              errorMessage={errors.currentPassword?.message}
              {...register('currentPassword')}
            />
            <Stack gap={2}>
              <Input
                id="new-password"
                type="password"
                size="lg"
                autoComplete="new-password"
                label={tAuth('changePassword.newPassword')}
                placeholder={tAuth('changePassword.placeholder.new')}
                disabled={isSubmitting}
                errorMessage={errors.newPassword?.message}
                {...register('newPassword')}
              />
              {newPassword && (
                <ValidationCheckList
                  items={validationItems}
                  className="text-xs"
                />
              )}
            </Stack>
            <Input
              id="confirm-password"
              type="password"
              size="lg"
              autoComplete="new-password"
              label={tAuth('changePassword.confirmPassword')}
              placeholder={tAuth('changePassword.placeholder.confirm')}
              disabled={isSubmitting}
              errorMessage={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
            <Button
              type="submit"
              size="lg"
              fullWidth
              disabled={isSubmitting || !isValid}
            >
              {isSubmitting
                ? tCommon('actions.saving')
                : tAuth('forcedChange.submit')}
            </Button>
          </Form>
        </FormSection>
      </Stack>
    </AuthFormLayout>
  );
}
