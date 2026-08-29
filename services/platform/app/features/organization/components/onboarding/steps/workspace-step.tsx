'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { toast } from '@/app/hooks/use-toast';
import { recordOrgSwitch } from '@/app/lib/backend/org';
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

/**
 * Whether a better-auth create failure means the slug is already in use.
 * Matches both the plugin's own code and the platform's
 * `beforeCreateOrganization` collision guard (an APIError whose message is
 * `Organization slug "…" is already taken.` with no stable code).
 */
export function isSlugTakenError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code === 'ORGANIZATION_SLUG_ALREADY_TAKEN') return true;
  return /already (?:taken|exists)/i.test(error.message ?? '');
}

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
  const { t: tSettings } = useT('settings');
  const { t } = useT('onboarding');
  const { locale } = useLocale();

  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  // Failure of the create call itself (server rejection, network) — distinct
  // from the derived `nameError` validation. Rendered inline on the input so
  // the failure is visible and persistent, not a console-only dead end.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // We don't ask for an organization language: assume the owner shares a
  // language with the organization, so adopt their detected client/browser
  // locale (clamped to a supported one). Persisted as the org's `defaultLocale`
  // and used to seed the prompt library in that language; changeable later in
  // organization settings.
  const orgLocale = clampToSupportedLocale(baseLanguage(locale));

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

  /**
   * The org this user already belongs to under the derived slug, if any. A
   * duplicate-slug 400 on retry usually means a previous Next click DID create
   * the org and a later call failed — resume into it instead of stranding the
   * user on a silent 400. `list()` is membership-scoped, so an unrelated org
   * that happens to own the slug can never be adopted this way.
   */
  const findOwnOrgBySlug = async (): Promise<string | null> => {
    const { data } = await authClient.organization.list();
    const existing = Array.isArray(data)
      ? data.find((org) => org.slug === slug)
      : undefined;
    return existing?.id ?? null;
  };

  const createWorkspace = async (): Promise<boolean> => {
    if (createdOrgId) return true;
    // The websocket may still be authenticating right after sign-up; the
    // current user isn't available yet. Stay on the step so the user can
    // retry once auth settles (Next is also gated on `user` via `valid`).
    if (!user) return false;
    setSubmitError(null);
    try {
      // better-auth reports request failures as `{ data: null, error }`
      // without throwing — inspect the result instead of assuming `data`.
      const result = await authClient.organization.create({
        name: trimmed,
        slug,
        metadata: { creatorId: user.userId, defaultLocale: orgLocale },
      });
      let organizationId = result?.data?.id ?? null;
      if (!organizationId) {
        organizationId = await findOwnOrgBySlug();
        if (!organizationId) {
          console.error('Error creating organization:', result?.error);
          setSubmitError(
            isSlugTakenError(result?.error)
              ? t('workspace.nameTakenError')
              : t('workspace.createError'),
          );
          return false;
        }
      }

      await authClient.organization.setActive({ organizationId });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      try {
        await recordOrgSwitch(organizationId);
      } catch (err) {
        console.warn('Failed to record org switch audit entry:', err);
      }

      onCreated(organizationId);
      toast({
        title: tSettings('organization.organizationCreated'),
        variant: 'success',
      });
      return true;
    } catch (error) {
      console.error('Error creating organization:', error);
      setSubmitError(t('workspace.createError'));
      return false;
    }
  };

  return (
    <WizardStep
      id="workspace"
      valid={nameValid && Boolean(user)}
      onBeforeNext={createWorkspace}
    >
      <Input
        id="org-name"
        type="text"
        label={tSettings('organization.organizationName')}
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (submitError) setSubmitError(null);
        }}
        placeholder={tSettings('organization.enterCompanyName')}
        errorMessage={nameError ?? submitError ?? undefined}
        disabled={Boolean(createdOrgId)}
      />
    </WizardStep>
  );
}
