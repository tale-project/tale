'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { useState, useMemo, useEffect } from 'react';
import * as z from 'zod';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useForm } from '@/app/components/ui/forms/use-form';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  createOptionalPasswordSchema,
  isPasswordValid,
} from '@/lib/shared/schemas/password';
import { narrowStringUnion } from '@/lib/utils/type-utils';

import { useCreateMember } from '../hooks/mutations';
import { useUserExistsByEmail } from '../hooks/queries';

// Type for the form data
type AddMemberFormData = {
  email: string;
  password?: string;
  displayName?: string;
  role: 'disabled' | 'admin' | 'developer' | 'editor' | 'member';
};

interface AddMemberDialogProps {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// This is the primary way to add users to Tale. Since the platform is offline-first,
// there is no self-service sign-up — admins create accounts here with an email,
// optional password, and role. For self-service provisioning, configure SSO or
// trusted headers instead (see docs/authentication.md).
export function AddMemberDialog({
  organizationId,
  open,
  onOpenChange,
}: AddMemberDialogProps) {
  const { t: tDialogs } = useT('dialogs');
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');

  const policy = usePasswordPolicy(organizationId);

  const addMemberSchema = useMemo(
    () =>
      z.object({
        email: z.string().email(tCommon('validation.email')),
        password: createOptionalPasswordSchema(
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
        displayName: z.string().optional(),
        role: z.enum(['disabled', 'admin', 'developer', 'editor', 'member']),
      }),
    [tCommon, tAuth, policy],
  );

  const [showCredentials, setShowCredentials] = useState(false);
  const [isExistingUser, setIsExistingUser] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const { toast } = useToast();

  const { mutateAsync: createMember, isPending: isSubmitting } =
    useCreateMember();
  const form = useForm<AddMemberFormData>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      email: '',
      password: '',
      displayName: '',
      role: 'member',
    },
  });

  const {
    handleSubmit,
    register,
    reset,
    setValue,
    setError,
    watch,
    formState,
  } = form;
  const selectedRole = watch('role');
  const password = watch('password') ?? '';
  const email = watch('email') ?? '';

  // For an email that already belongs to a user, the backend reuses their
  // existing credentials and ignores any password, so we hide the field
  // entirely rather than asking for something that won't be used.
  const emailBelongsToExistingUser = useUserExistsByEmail(email);

  const passwordValidationItems = usePasswordValidation(password, policy);

  // Drop any password the admin had typed before we learned the email matches
  // an existing user — otherwise a stale validation error on the now-hidden
  // field would keep the form from submitting.
  useEffect(() => {
    if (emailBelongsToExistingUser && password) {
      setValue('password', '', { shouldValidate: true });
    }
  }, [emailBelongsToExistingUser, password, setValue]);

  // Proactive-validation parity with the sibling password forms (#2687): a
  // brand-new email cannot be created without a password, so keep submit
  // disabled until the typed password satisfies the policy instead of letting
  // the click bounce off the backend's PASSWORD_REQUIRED error. An existing
  // user's credentials are reused, so that path stays gated by the schema
  // alone. This lives outside the Zod schema because the existing-user flag
  // flips asynchronously (debounced lookup) without an input event, which
  // would leave a schema-derived `isValid` stale; the PASSWORD_REQUIRED
  // handler below remains the backstop for that lookup race.
  const canSubmit =
    formState.isValid &&
    (emailBelongsToExistingUser || isPasswordValid(password, policy));

  const onSubmit = async (data: AddMemberFormData) => {
    try {
      const result = await createMember({
        organizationId,
        email: data.email,
        password: data.password || undefined,
        displayName: data.displayName,
        role: data.role,
      });

      toast({
        title: result.isExistingUser
          ? tToast('success.existingUserAdded.title')
          : tToast('success.newMemberCreated.title'),
        description: result.isExistingUser
          ? tToast('success.existingUserAdded.description')
          : tToast('success.newMemberCreated.description'),
        variant: 'success',
      });

      if (result.isExistingUser) {
        setIsExistingUser(true);
        setShowCredentials(true);
      } else if (data.password) {
        setIsExistingUser(false);
        setCredentials({ email: data.email, password: data.password });
        setShowCredentials(true);
      } else {
        reset();
        onOpenChange(false);
      }
    } catch (error) {
      console.error(error);
      // A new user requires a password; surface it on the field rather than a
      // generic toast, so the user knows what to fix (#1470).
      if (
        error instanceof ConvexError &&
        error.data?.code === 'PASSWORD_REQUIRED'
      ) {
        setError('password', {
          message: tAuth('validation.passwordRequiredForNewUser'),
        });
        return;
      }
      // The email is already a member of this org; surface it on the email
      // field rather than a generic toast (#2018).
      if (
        error instanceof ConvexError &&
        error.data?.code === 'DUPLICATE_MEMBER'
      ) {
        setError('email', {
          message: tAuth('validation.emailAlreadyMember'),
        });
        return;
      }
      toast({
        title: tToast('error.addMemberFailed.title'),
        description: tToast('error.addMemberFailed.description'),
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    setShowCredentials(false);
    setIsExistingUser(false);
    setCredentials(null);
    reset();
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !showCredentials) {
      reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <>
      <FormDialog
        open={open && !showCredentials}
        onOpenChange={handleOpenChange}
        title={tDialogs('addMember.title')}
        submitText={tDialogs('addMember.title')}
        submittingText={tCommon('actions.adding')}
        isSubmitting={isSubmitting}
        isValid={canSubmit}
        onSubmit={handleSubmit(onSubmit)}
      >
        <Input
          id="displayName"
          label={tSettings('form.name')}
          placeholder={tSettings('form.namePlaceholder')}
          required={false}
          {...register('displayName')}
          className="w-full"
        />

        <Input
          id="email"
          type="email"
          label={tSettings('form.email')}
          placeholder={tSettings('form.emailPlaceholder')}
          {...register('email')}
          className="w-full"
          required
          errorMessage={formState.errors.email?.message}
        />

        <Select
          value={selectedRole}
          onValueChange={(value) => {
            const narrowed = narrowStringUnion<
              'disabled' | 'admin' | 'developer' | 'editor' | 'member'
            >(value, [
              'disabled',
              'admin',
              'developer',
              'editor',
              'member',
            ] as const);
            if (narrowed) {
              setValue('role', narrowed, { shouldDirty: true });
            }
          }}
          label={tSettings('form.role')}
          options={[
            { value: 'admin', label: tSettings('roles.admin') },
            { value: 'developer', label: tSettings('roles.developer') },
            { value: 'editor', label: tSettings('roles.editor') },
            { value: 'member', label: tSettings('roles.member') },
            { value: 'disabled', label: tSettings('roles.disabled') },
          ]}
        />

        {emailBelongsToExistingUser ? (
          <Text variant="muted" className="text-sm">
            {tDialogs('addMember.existingUserHint')}
          </Text>
        ) : (
          <FormSection>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              label={tSettings('form.password')}
              placeholder={tSettings('form.passwordPlaceholder')}
              description={tSettings('form.forgotPassword')}
              {...register('password')}
              errorMessage={formState.errors.password?.message}
              className="w-full"
            />
            {password && (
              <ValidationCheckList
                items={passwordValidationItems}
                className="text-xs"
              />
            )}
          </FormSection>
        )}
      </FormDialog>

      <ViewDialog
        open={showCredentials}
        onOpenChange={handleClose}
        title={tDialogs('memberAdded.title')}
        description={
          isExistingUser
            ? tDialogs('memberAdded.existingUserNotice')
            : tDialogs('memberAdded.credentialsWarning')
        }
      >
        <Stack gap={4}>
          {!isExistingUser && credentials && (
            <Stack gap={4}>
              <CopyableField
                value={credentials.email}
                label={tSettings('form.email')}
              />
              <CopyableField
                value={credentials.password}
                label={tSettings('form.password')}
              />
            </Stack>
          )}

          <Button onClick={handleClose} fullWidth>
            {tCommon('actions.done')}
          </Button>
        </Stack>
      </ViewDialog>
    </>
  );
}
