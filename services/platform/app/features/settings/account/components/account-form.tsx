'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize, useSkeleton } from '@tale/ui/skeleton-context';
import { useCallback, useMemo, useState } from 'react';
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
import { useForm } from '@/app/components/ui/forms/use-form';
import { useHasCredentialAccount } from '@/app/features/auth/hooks/queries';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsRow } from '@/app/features/settings/components/settings-row';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { usePasswordPolicy } from '@/app/features/settings/governance/hooks/queries';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { usePasswordValidation } from '@/app/hooks/use-password-validation';
import { useToast } from '@/app/hooks/use-toast';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';
import { createPasswordSchema } from '@/lib/shared/schemas/password';
import { convexErrorCode } from '@/lib/utils/convex-error';
import { deriveNameFromEmail } from '@/lib/utils/derive-name-from-email';

import { useUpdatePassword, useUpdateUserName } from '../hooks/mutations';
import { ChatsSection } from './chats-section';
import { PasskeySection } from './passkey-section';
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
// wraps the real full-width view in `<Skeletonize>` so the skeleton inherits
// the SAME row structure (no horizontal shift on load, and no empty-Input →
// real-value flash). Skeleton-aware leaves (Input, Button) mask themselves
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
// Plain presentational view — renders the real full-width settings layout.
// Rendered both live and (wrapped in `<Skeletonize>`) as its own skeleton, so
// loading and loaded layouts are the SAME tree and cannot drift.
// =============================================================================
function AccountFormView({ hasCredential }: { hasCredential: boolean }) {
  return (
    <SettingsPage>
      <ProfileSection />
      <PasswordSection hasCredential={hasCredential} />
      <TwoFactorSection />
      <PasskeySection />
      <ChatsSection />
    </SettingsPage>
  );
}

function ProfileSection() {
  const { t: tSettings } = useT('settings');
  const { t: tToast } = useT('toast');
  const { user } = useAuth();
  const { mutateAsync: updateUserName } = useUpdateUserName();

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

  const data = useMemo<ProfileFormData | undefined>(() => {
    if (!user) return undefined;
    const email = user.email ?? '';
    const savedName = user.name?.trim() ?? '';
    // Legacy owner accounts were created with `name === email` (see the
    // onboarding account step); treat that — and an empty name — as "no real
    // name yet" and offer an editable suggestion derived from the email.
    const name =
      savedName && savedName !== email ? savedName : deriveNameFromEmail(email);
    return { name };
  }, [user]);

  // Save feedback belongs to the settings header's Save/Discard cluster: it
  // flashes "Saved" on success and raises the single destructive toast on
  // failure. The password, two-factor and passkey dialogs below own their own
  // submits and keep their toasts.
  const save = useCallback(
    async (values: ProfileFormData) => {
      const name = values.name.trim();
      try {
        await updateUserName({ name });
      } catch (err) {
        console.error('[account] profile save failed', err);
        throw new Error(tToast('error.profileUpdateFailed.title'), {
          cause: err,
        });
      }
    },
    [tToast, updateUserName],
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
      formState: { errors },
    },
  } = editor;

  return (
    <SettingsSection
      title={tSettings('account.profile.title')}
      description={tSettings('account.profile.description')}
    >
      {/* Submit through the controller, never `form.handleSubmit(save)`: that
          second path would skip the dirty-baseline reset and leave a failed
          save with no cluster to report it. */}
      <Form id="account-profile-form" onSubmit={editor.submit}>
        {/* Settings-row layout (label + helper text left, control pinned
            right, divider between rows) mirroring the Organization details
            block. */}
        <fieldset
          disabled={editor.isLoading}
          className="divide-border divide-y"
        >
          {/* Email first, then Name — the email implies the suggested name
              (#1941), so it reads top-to-bottom as cause then effect. */}
          <SettingsRow
            className="py-5"
            label={tSettings('account.profile.email')}
            description={tSettings('account.profile.emailDescription')}
          >
            <div className="w-full sm:w-80">
              <EmailField email={user?.email ?? ''} />
            </div>
          </SettingsRow>

          <SettingsRow
            className="py-5"
            label={tSettings('account.profile.name')}
            description={tSettings('account.profile.nameDescription')}
            required
          >
            <div className="w-full sm:w-80">
              <Input
                id="name"
                // The visible label lives on the enclosing SettingsRow, which
                // names a wrapper div — give the input its own accessible name
                // so assistive tech (and getByRole) can reach the control.
                aria-label={tSettings('account.profile.name')}
                placeholder={tSettings('account.profile.namePlaceholder')}
                required
                disabled={editor.isSaving}
                errorMessage={errors.name?.message}
                wrapperClassName="w-full"
                {...register('name')}
              />
            </div>
          </SettingsRow>
        </fieldset>
      </Form>
    </SettingsSection>
  );
}

/** Read-only email pill. Visually mirrors the `CopyableField` pill used for the
 *  Organization ID elsewhere in settings — same bg, border, radius, padding —
 *  so any "you can read this but can't edit it here" surface looks consistent.
 *  Doesn't render a copy button because nobody copies their own email out of
 *  Account settings. The field label lives on the enclosing `SettingsRow`. */
function EmailField({ email }: { email: string }) {
  const loading = useSkeleton();

  return (
    <Row
      gap={0}
      className="bg-muted/40 ring-border text-muted-foreground w-full rounded-lg border px-3 py-2.25 text-sm"
    >
      {loading ? <SkeletonText /> : email}
    </Row>
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
      action={
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {hasCredential
            ? tAuth('changePassword.title')
            : tAuth('setPassword.title')}
        </Button>
      }
    >
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
    setError,
    watch,
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
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
    } catch (error) {
      // A wrong current password is an expected, recoverable failure — surface
      // it as an inline field error on the current-password input (mirroring
      // the 2FA / add-member flows) rather than a generic destructive toast
      // (#1945). The backend raises a structured ConvexError for this case.
      if (convexErrorCode(error) === 'INVALID_CURRENT_PASSWORD') {
        setError('currentPassword', {
          type: 'manual',
          message: tAuth('changePassword.validation.currentIncorrect'),
        });
        return;
      }
      toast({
        title: tToast('error.passwordChangeFailed.title'),
        description: tToast('error.passwordChangeFailed.description'),
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
      description={tAuth('changePassword.warning.description')}
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
        required
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
          required
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
        required
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
        title: tToast('success.passwordSet.title'),
        description: tToast('success.passwordSet.description'),
        variant: 'success',
      });

      reset();
      onOpenChange(false);
    } catch {
      toast({
        title: tToast('error.passwordChangeFailed.title'),
        description: tToast('error.passwordChangeFailed.description'),
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
          required
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
        required
        disabled={isSubmitting}
        errorMessage={errors.confirmPassword?.message}
        {...register('confirmPassword')}
      />
    </FormDialog>
  );
}
