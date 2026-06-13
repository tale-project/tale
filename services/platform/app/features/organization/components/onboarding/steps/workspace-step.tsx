'use client';

import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from 'convex/react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useInitializeDefaultWorkflows } from '@/app/features/organization/hooks/actions';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';
import { useT } from '@/lib/i18n/client';
import { MAX_ORG_SLUG_LENGTH } from '@/lib/shared/constants/org-slug';
import { isReservedOrgSlug } from '@/lib/shared/constants/reserved-org-slugs';
import { clampToSupportedLocale } from '@/lib/shared/utils/get-organization-default-locale';

/**
 * Derive the on-disk slug from a free-form display name. Mirrors
 * `services/platform/lib/shared/constants/org-slug.ts` ORG_SLUG_REGEX and
 * truncates to the shared cap so a long name can't mint a slug the
 * RAG/crawler validators would reject.
 */
function deriveOrgSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORG_SLUG_LENGTH);
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

// Language autonyms (each in its own language) — the convention for a language
// picker, so they need no translation namespace. Mirrors the first-run
// preferences picker.
const ORG_LOCALES: { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
];

/** Base language subtag of a locale (e.g. `en-US` → `en`). */
function baseLanguage(locale: string): string {
  try {
    return new Intl.Locale(locale).language ?? locale;
  } catch (error) {
    console.warn('Failed to parse locale tag:', locale, error);
    return locale;
  }
}

interface WorkspaceStepProps {
  /** Already-created org id (set once the workspace exists) — keeps the input
   *  disabled and the step idempotent if the user steps back into it. */
  createdOrgId: string | null;
  /** Lifts the new org id so later steps (provider, finish) can use it. */
  onCreated: (organizationId: string) => void;
}

export function WorkspaceStep({ createdOrgId, onCreated }: WorkspaceStepProps) {
  const { user } = useAuth();
  const { t } = useT('onboarding');
  const { t: tSettings } = useT('settings');
  const { t: tCommon } = useT('common');
  const { locale } = useLocale();

  const recordOrgSwitch = useMutation(
    api.organizations.record_org_switch.recordOrgSwitch,
  );
  const { mutateAsync: initializeDefaultWorkflows } =
    useInitializeDefaultWorkflows();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  // Default to the user's current UI language (English by default), clamped to
  // a supported locale. Persisted as the org's `defaultLocale` and used to
  // seed the prompt library in that language.
  const [orgLocale, setOrgLocale] = useState(() =>
    clampToSupportedLocale(baseLanguage(locale)),
  );

  const trimmed = name.trim();
  const slug = deriveOrgSlug(name);
  const nameValid =
    trimmed.length > 0 &&
    NAME_PATTERN.test(trimmed) &&
    !isReservedOrgSlug(slug);

  const nameError =
    trimmed.length === 0
      ? undefined
      : !NAME_PATTERN.test(trimmed)
        ? tSettings('organization.companyNameCharacterError')
        : isReservedOrgSlug(slug)
          ? tSettings('organization.nameReserved')
          : undefined;

  const createWorkspace = async (): Promise<boolean> => {
    if (createdOrgId) return true;
    // The websocket may still be authenticating right after sign-up; the
    // current user isn't available yet. Stay on the step so the user can
    // retry once auth settles (Next is also gated on `user` via `valid`).
    if (!user) return false;
    try {
      const result = await authClient.organization.create({
        name: trimmed,
        slug,
        metadata: { creatorId: user.userId, defaultLocale: orgLocale },
      });
      const newOrgId = result?.data?.id;
      if (!newOrgId) throw new Error('Organization id missing from response');

      await authClient.organization.setActive({ organizationId: newOrgId });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      await initializeDefaultWorkflows({ organizationId: newOrgId });
      try {
        await recordOrgSwitch({ organizationId: newOrgId });
      } catch (err) {
        console.warn('Failed to record org switch audit entry:', err);
      }

      onCreated(newOrgId);
      toast({
        title: tSettings('organization.organizationCreated'),
        variant: 'success',
      });
      return true;
    } catch (error) {
      console.error('Error creating organization:', error);
      toast({
        title: tCommon('errors.unexpectedError'),
        variant: 'destructive',
      });
      return false;
    }
  };

  return (
    <WizardStep
      id="workspace"
      valid={nameValid && Boolean(user)}
      onBeforeNext={createWorkspace}
    >
      <Heading level={2} className="text-base">
        {t('workspace.heading')}
      </Heading>
      <Text variant="muted">{t('workspace.why')}</Text>
      <Input
        id="org-name"
        type="text"
        label={tSettings('organization.organizationName')}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={tSettings('organization.enterCompanyName')}
        errorMessage={nameError}
        disabled={Boolean(createdOrgId)}
        description={
          slug
            ? tSettings('organization.identifierPreview', { slug })
            : undefined
        }
      />
      <Select
        label={t('preferences.languageLabel')}
        description={t('workspace.languageDescription')}
        options={ORG_LOCALES}
        value={orgLocale}
        onValueChange={setOrgLocale}
        disabled={Boolean(createdOrgId)}
      />
    </WizardStep>
  );
}
