'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import {
  useFormEditor,
  useRegisterActiveEditor,
} from '@/app/components/ui/editor';
import { ValidationCheckList } from '@/app/components/ui/feedback/validation-check-item';
import { Form } from '@/app/components/ui/forms/form';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Label } from '@/app/components/ui/forms/label';
import { useHasCredentialAccount } from '@/app/features/auth/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';

import { useUpdatePassword, useUpdateUserName } from '../hooks/mutations';
import { TwoFactorSection } from './two-factor-section';

interface ProfileFormData {
  name: string;
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

// =============================================================================
// Container — owns the loading state (current user + credential probe) and
// wraps the real `SettingsPage narrow` view in `<Skeletonize>` so the skeleton
// inherits the SAME narrow centering and section structure (no horizontal
// shift on load, and no empty-Input → real-value flash). Skeleton-aware leaves
// (Input, Button) and `<SkeletonText>` for the read-only email mask themselves
// while loading.
// =============================================================================
export function AccountForm() {
  const { data: hasCredential, isLoading: isCredentialLoading } =
    useHasCredentialAccount();
  const { isLoading: isUserLoading } = useAuth();

  return (
    <Skeletonize loading={isUserLoading || isCredentialLoading}>
      <AccountFormView hasCredential={hasCredential ?? false} />
    </Skeletonize>
  );
}

// =============================================================================
// Plain presentational view — renders the real `SettingsPage narrow` layout.
// Rendered both live and (wrapped in `<Skeletonize>`) as its own skeleton, so
// loading and loaded layouts are the SAME tree and cannot drift.
// =============================================================================
function AccountFormView({ hasCredential }: { hasCredential: boolean }) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return (
    <SettingsPage
      title={tNav('account')}
      description={tSettings('menu.account.description')}
      narrow
    >
      <ProfileSection />
      <PasswordSection hasCredential={hasCredential} />
      <TwoFactorSection />
    </SettingsPage>
  );
}

function ProfileSection() {
  const { t: tSettings } = useT('settings');
  const { t: tToast } = useT('toast');
  const { user } = useAuth();
  const { mutateAsync: updateUserName } = useUpdateUserName();
  const { toast } = useToast();

  const profileSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .trim()
          .min(1, tSettings('account.profile.nameRequired')),
      }),
    [tSettings],
  );

  const data = useMemo<ProfileFormData | undefined>(
    () => (user ? { name: user.name ?? '' } : undefined),
    [user],
  );

  const save = useCallback(
    async (values: ProfileFormData) => {
      const name = values.name.trim();
      try {
        await updateUserName({ name });
        toast({
          title: tToast('success.profileUpdated'),
          variant: 'success',
        });
      } catch (err) {
        toast({
          title: tToast('error.profileUpdateFailed'),
          variant: 'destructive',
        });
        throw err;
      }
    },
    [toast, tToast, updateUserName],
  );

  const editor = useFormEditor<ProfileFormData>({
    data,
    schema: profileSchema,
    save,
  });

  useRegisterActiveEditor(editor);

  const {
    form: {
      register,
      handleSubmit,
      formState: { errors },
    },
  } = editor;

  return (
    <SettingsSection
      title={tSettings('account.profile.title')}
      description={tSettings('account.profile.description')}
    >
      <Form
        id="account-profile-form"
        onSubmit={handleSubmit((values) => save(values))}
      >
        <fieldset disabled={editor.isLoading} className="contents space-y-4">
          <Input
            id="display-name"
            label={tSettings('account.profile.name')}
            placeholder={tSettings('account.profile.namePlaceholder')}
            disabled={editor.isSaving}
            errorMessage={errors.name?.message}
            wrapperClassName="max-w-sm"
            {...register('name')}
          />
          <EmailField email={user?.email ?? ''} />
        </fieldset>
      </Form>
    </SettingsSection>
  );
}

/** Read-only email row. `Text` isn't a skeleton-aware leaf, so mask it with
 *  `<SkeletonText>` sized to the body line-height while loading — without this
 *  the value pops in after the user query resolves. */
function EmailField({ email }: { email: string }) {
  const { t: tSettings } = useT('settings');
  const loading = useSkeleton();

  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <Label>{tSettings('account.profile.email')}</Label>
      {loading ? (
        <div className="w-48 text-base leading-normal">
          <SkeletonText />
        </div>
      ) : (
        <Text as="span" variant="body">
          {email}
        </Text>
      )}
    </div>
  );
}

interface PasswordSectionProps {
  hasCredential: boolean;
}

function PasswordSection({ hasCredential }: PasswordSectionProps) {
  const { t: tAuth } = useT('auth');
  const { t: tSettings } = useT('settings');
  const [open, setOpen] = useState(false);

  return (
    <SettingsSection
      title={tSettings('account.security.title')}
      description={tSettings('account.security.description')}
    >
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {hasCredential
            ? tAuth('changePassword.title')
            : tAuth('setPassword.title')}
        </Button>
      </div>

      {hasCredential ? (
        <ChangePasswordDialog open={open} onOpenChange={setOpen} />
      ) : (
        <SetPasswordDialog open={open} onOpenChange={setOpen} />
      )}
    </SettingsSection>
  );
}

interface PasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ChangePasswordDialog({ open, onOpenChange }: PasswordDialogProps) {
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const organizationId = useOrganizationId();
  const policy = usePasswordPolicy(organizationId);

  const changePasswordSchema = useMemo(
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty, isValid },
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
  const passwordValidationItems = usePasswordValidation(newPassword, policy);

  const onSubmit = async (data: ChangePasswordFormData) => {
    try {
      await updatePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
      return;
    }

    // Changing the password revokes/rotates the user's sessions server-side,
    // so the current client token is now stale — every subsequent query would
    // fail with "Unauthenticated" and a manual refresh would bounce the user to
    // login mid-action (#1255). Sign the user out and hard-navigate to login so
    // they re-authenticate with the new password. Hard navigation (not the
    // router) avoids the stale-auth query race documented in the sign-out flow.
    reset();
    onOpenChange(false);
    try {
      await signOut();
    } catch (error) {
      console.warn('Sign-out after password change failed', error);
    }
    window.location.href = getEnv('BASE_PATH') || '/';
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tAuth('changePassword.title')}
      submitText={tAuth('changePassword.title')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="current-password"
        type="password"
        autoComplete="current-password"
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
          autoComplete="new-password"
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
        autoComplete="new-password"
        label={tAuth('changePassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
    </FormDialog>
  );
}

function SetPasswordDialog({ open, onOpenChange }: PasswordDialogProps) {
  const { t: tAuth } = useT('auth');
  const { t: tToast } = useT('toast');
  const { mutateAsync: updatePassword } = useUpdatePassword();
  const { toast } = useToast();
  const organizationId = useOrganizationId();
  const policy = usePasswordPolicy(organizationId);

  const setPasswordSchema = useMemo(
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

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty, isValid },
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
  const passwordValidationItems = usePasswordValidation(newPassword, policy);

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
      onOpenChange(false);
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed'),
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={tAuth('setPassword.title')}
      description={tAuth('setPassword.description')}
      submitText={tAuth('setPassword.title')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      isValid={isValid}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormSection>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
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
        autoComplete="new-password"
        label={tAuth('setPassword.confirmPassword')}
        placeholder={tAuth('changePassword.placeholder.confirm')}
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
    </FormDialog>
  );
}
