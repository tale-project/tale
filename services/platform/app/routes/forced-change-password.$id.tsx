import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, VStack } from '@/app/components/ui/layout/layout';
import { LogoLink } from '@/app/components/ui/logo/logo-link';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useUpdatePassword } from '@/app/features/settings/account/hooks/mutations';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';

export const Route = createFileRoute('/forced-change-password/$id')({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session?.data?.user) {
      throw redirect({ to: '/log-in' });
    }
  },
  component: ForcedChangePasswordPage,
});

type ForcedChangeFormData = {
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

  const { data: expiryStatus } = useConvexQuery(
    api.users.queries.getPasswordExpiryStatus,
  );
  useEffect(() => {
    if (!expiryStatus) return;
    // OAuth-only or already-fresh credential: no reason to be here.
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
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const { register, handleSubmit, formState, watch } = form;
  const { errors, isSubmitting, isValid } = formState;
  const newPassword = watch('newPassword');
  const validationItems = usePasswordValidation(newPassword, policy);

  const onSubmit = async (data: ForcedChangeFormData) => {
    try {
      await updatePassword({
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
    } catch (e) {
      console.error(e);
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <VStack
      gap={0}
      align="stretch"
      className="bg-background text-foreground min-h-screen"
    >
      <div className="px-4 pt-8 pb-16 sm:px-8">
        <LogoLink href="/" />
      </div>
      <main id="main-content" className="flex-1">
        <div className="mx-auto w-full max-w-md px-4">
          <Stack gap={6}>
            <Stack gap={2} className="text-center">
              <Heading level={1} size="xl" className="tracking-[-0.12px]">
                {tAuth('forcedChange.title')}
              </Heading>
              <Text variant="muted" className="text-sm">
                {tAuth(
                  expiryStatus?.reason === 'admin_set'
                    ? 'forcedChange.descriptionAdminSet'
                    : 'forcedChange.description',
                )}
              </Text>
            </Stack>
            <div className="border-border bg-card rounded-lg border p-6 shadow-sm">
              <FormSection>
                <Form onSubmit={handleSubmit(onSubmit)} autoComplete="on">
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
            </div>
          </Stack>
        </div>
      </main>
    </VStack>
  );
}
