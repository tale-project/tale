import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { Form } from '@tale/ui/form';
import { FormSection } from '@tale/ui/form-section';
import { Heading } from '@tale/ui/heading';
import { Input } from '@tale/ui/input';
import { Stack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useForm } from '@tale/ui/use-form';
import { useToast } from '@tale/ui/use-toast';
import { ValidationCheckList } from '@tale/ui/validation-check-item';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { z } from 'zod';

import { STANDALONE_PAGE } from '@/app/components/layout/standalone-page';
import { LogoLink } from '@/app/components/logo/logo-link';
import {
  isPasswordPolicyViolation,
  useUpdatePassword,
} from '@/app/features/settings/account/hooks/mutations';
import { useMyPasswordPolicy } from '@/app/features/settings/account/hooks/queries';
import {
  useNewPasswordSchema,
  usePasswordValidation,
} from '@/app/hooks/use-password-validation';
import { useAuth } from '@/app/hooks/use-session-user';
import { passwordExpiryQuery } from '@/app/lib/backend/account';
import { authClient } from '@/lib/auth-client';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

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

export function ForcedChangePasswordPage() {
  const { id: organizationId } = Route.useParams();
  const navigate = useNavigate();
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');
  const { toast } = useToast();
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const policy = useMyPasswordPolicy();
  const newPasswordSchema = useNewPasswordSchema(policy);
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
      // Hard navigation to fully drop auth state — see UserButton for rationale.
      window.location.href = getEnv('BASE_PATH') || '/';
    } catch (e) {
      console.error(e);
      toast({
        title: tAuth('userButton.toast.signOutFailed'),
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  // Password-recovery flow can run with a restricted/!isAuthenticated session;
  // preserve the prior ungated behavior (the query enforces auth server-side).
  const { data: expiryStatus } = useQuery(passwordExpiryQuery());
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
          newPassword: newPasswordSchema,
          confirmPassword: z
            .string()
            .min(1, tAuth('changePassword.validation.confirmRequired')),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: tAuth('changePassword.validation.mismatch'),
          path: ['confirmPassword'],
        }),
    [tAuth, newPasswordSchema],
  );

  const form = useForm<ForcedChangeFormData>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const { register, handleSubmit, formState, setError, watch } = form;
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
        title: tToast('success.passwordChanged.title'),
        description: tToast('success.passwordChanged.description'),
        variant: 'success',
      });
      void navigate({
        to: '/dashboard/$id',
        params: { id: organizationId },
        replace: true,
      });
    } catch (e) {
      console.error(e);
      // The server holds the new password to the effective policy; its
      // refusal is the only check when the policy never loaded.
      if (isPasswordPolicyViolation(e)) {
        setError('newPassword', {
          type: 'manual',
          message: tAuth('changePassword.validation.policyViolation'),
        });
        return;
      }
      toast({
        title: tToast('error.passwordChangeFailed.title'),
        description: tToast('error.passwordChangeFailed.description'),
        variant: 'destructive',
      });
    }
  };

  return (
    <VStack
      gap={0}
      align="stretch"
      className={cn('bg-background text-foreground', STANDALONE_PAGE)}
    >
      <div className="px-4 pt-8 pb-16 sm:px-8">
        <LogoLink href="/" />
      </div>
      {/* outline-none: skip-link target focused only programmatically — the
          browser's focus ring would outline the whole page body. */}
      <main id="main-content" className="flex-1 outline-none" tabIndex={-1}>
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
              {user?.email && (
                <Text variant="muted" className="text-xs">
                  {tAuth('forcedChange.signedInAs', { email: user.email })}
                </Text>
              )}
            </Stack>
            <div className="border-border bg-card rounded-lg border p-6 shadow-sm">
              <FormSection>
                <Form onSubmit={handleSubmit(onSubmit)} autoComplete="on">
                  <Stack gap={2}>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      label={tAuth('changePassword.newPassword')}
                      placeholder={tAuth('changePassword.placeholder.new')}
                      disabled={isSubmitting}
                      errorMessage={errors.newPassword?.message}
                      {...register('newPassword')}
                    />
                    {newPassword && validationItems.length > 0 && (
                      <ValidationCheckList
                        items={validationItems}
                        className="text-xs"
                      />
                    )}
                  </Stack>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    label={tAuth('changePassword.confirmPassword')}
                    placeholder={tAuth('changePassword.placeholder.confirm')}
                    disabled={isSubmitting}
                    errorMessage={errors.confirmPassword?.message}
                    {...register('confirmPassword')}
                  />
                  <Button
                    type="submit"
                    fullWidth
                    disabled={!isValid}
                    isLoading={isSubmitting}
                  >
                    {tAuth('forcedChange.submit')}
                  </Button>
                </Form>
              </FormSection>
            </div>
            <Text variant="muted" className="text-center text-xs">
              {tAuth('forcedChange.notYou')}{' '}
              <button
                type="button"
                onClick={handleSignOut}
                className="text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {tAuth('forcedChange.logOut')}
              </button>
            </Text>
          </Stack>
        </div>
      </main>
    </VStack>
  );
}
