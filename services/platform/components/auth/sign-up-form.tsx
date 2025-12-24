'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { MicrosoftIcon } from '@/components/ui/icons';
import { AuthFormLayout } from '@/components/layout';
import { useT } from '@/lib/i18n';

// Zod validation schema
const signUpSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/\d/, 'Password must contain at least one number')
    .regex(
      /[!@#$%^&*(),.?":{}|<>]/,
      'Password must contain at least one special character',
    ),
});

type SignUpFormData = z.infer<typeof signUpSchema>;

interface SignUpFormProps {
  microsoftEnabled?: boolean;
}

export default function SignUpForm({
  microsoftEnabled = false,
}: SignUpFormProps) {
  const router = useRouter();
  const { t } = useT('auth');

  // Single form for both email and password
  const form = useForm<SignUpFormData>({
    resolver: zodResolver(signUpSchema),
    mode: 'onChange',
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const { isSubmitting, errors } = form.formState;
  const password = form.watch('password');

  // Handle form submission
  const handleSubmit = async (data: SignUpFormData) => {
    // Clear any previous auth errors
    form.setError('password', { message: '' });
    form.clearErrors('password');

    try {
      // Create user account with Better Auth and sign in
      const result = await authClient.signUp.email(
        { name: data.email, email: data.email, password: data.password },
        {
          onError: (ctx) => {
            const errorMessage = ctx.error.message || 'Wrong email or password';
            form.setError('password', { message: errorMessage });
          },
        },
      );

      if (result.error) {
        form.setError('password', {
          message: result.error.message || 'Wrong email or password',
        });
        return;
      }

      toast({
        title: 'Account created successfully!',
        variant: 'success',
      });

      router.push('/dashboard');
    } catch (error) {
      console.error('Sign up error:', error);
      toast({
        title: 'Something went wrong',
        variant: 'destructive',
      });
    }
  };

  const handleMicrosoftSignUp = async () => {
    try {
      await authClient.signIn.social({
        provider: 'microsoft',
        callbackURL: '/dashboard',
      });
    } catch (error) {
      console.error('Microsoft sign-in error:', error);
      toast({
        title: 'Microsoft sign-in failed. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <AuthFormLayout title={t('signup.signupTitle')}>
      <div className="space-y-8">
        <div className="space-y-5">
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5"
            autoComplete="on"
          >
            {/* Email Field */}
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                size="lg"
                placeholder={t('emailPlaceholder')}
                disabled={isSubmitting}
                autoComplete="email"
                className="border-border shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                {...form.register('email')}
              />
              {errors.email && (
                <p className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label
                htmlFor="password"
                error={Boolean(errors.password?.message)}
              >
                {t('password')}
              </Label>
              <Input
                id="password"
                type="password"
                size="lg"
                placeholder={t('passwordPlaceholder')}
                disabled={isSubmitting}
                autoComplete="new-password"
                errorMessage={errors.password?.message}
                className="shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
                {...form.register('password')}
              />
              {password && (
                <ul className="text-xs space-y-1 text-muted-foreground list-none">
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.length')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.lowercase')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.uppercase')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.number')}
                  </li>
                  <li className="relative pl-4 before:content-['-'] before:absolute before:left-0">
                    {t('requirements.specialChar')}
                  </li>
                </ul>
              )}
            </div>

            {/* Sign Up Button */}
            <div>
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={
                  isSubmitting ||
                  !form.watch('email')?.trim() ||
                  !form.watch('password')?.trim() ||
                  !!errors.password ||
                  !!errors.email
                }
              >
                {isSubmitting ? t('signup.creating') : t('signup.createButton')}
              </Button>
            </div>
          </form>
        </div>

        {/* Microsoft Login - only shown if Microsoft Entra ID is configured */}
        {microsoftEnabled && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-muted" />
            </div>

            <Button
              onClick={handleMicrosoftSignUp}
              variant="outline"
              size="lg"
              className="w-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.03)]"
              disabled={isSubmitting}
            >
              <span className="mr-3 inline-flex">
                <MicrosoftIcon />
              </span>
              {t('continueWithMicrosoft')}
            </Button>
          </>
        )}
      </div>
    </AuthFormLayout>
  );
}
