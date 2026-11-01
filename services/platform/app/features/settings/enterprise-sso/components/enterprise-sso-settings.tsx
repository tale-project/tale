'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useRef } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { EmbeddingSection } from '@/app/features/settings/trusted-headers/components/embedding-section';
import { TrustedHeadersSection } from '@/app/features/settings/trusted-headers/components/trusted-headers-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { failureDetail } from '@/app/lib/backend/adapters';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import { useEnterpriseSso } from '../hooks/use-enterprise-sso';
import {
  EnterpriseSsoForm,
  type EnterpriseSsoConfig,
} from './enterprise-sso-form';

/**
 * Dedicated "Enterprise SSO" settings page — sign-in (OIDC/OAuth2/SAML) +
 * SCIM provisioning for the org, with per-provider setup guidance, plus the
 * trusted-headers card (an application's authenticating proxy signing its
 * users in with the organization's key). Admin-gated (`orgSettings`),
 * matching the config mutations' `isAdmin` requirement.
 */
export function EnterpriseSsoSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tAccessDenied } = useT('accessDenied');
  const { t: tSettings } = useT('settings');
  const { t: tNav } = useT('navigation');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  // Only a role that may read the settings asks for them: the server refuses
  // every other (SSO-R22), and a refusal would show as a failed read.
  const connection = useEnterpriseSso(
    organizationId,
    !abilityLoading && ability.can('read', 'orgSettings'),
  );
  const { refetch } = connection;
  // `undefined` until the connection has answered; the form shows its
  // loading state meanwhile.
  const config: EnterpriseSsoConfig | undefined = connection.data;
  // A read that failed is named, with Try again: never a blank form that
  // reads as an organization without SSO, and never a repair notice for a
  // fault (#4653). The flags hold through a retry, which react-query starts
  // from `pending`.
  const read = readStateOf(connection);
  // What the last failure says about itself — an unreadable connection.yml's
  // repair sentence (#4264), a lost connection; nothing for a fault. Kept
  // through a retry, which clears the read's error.
  const failureRef = useRef<string | undefined>(undefined);
  if (connection.isError) {
    failureRef.current = failureDetail(connection.error);
  }
  // Where a Try again that gave way hands its focus: the connection's first
  // section, the failure's own while nothing is read.
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = useCallback(() => sectionRef.current?.focus(), []);

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('enterpriseSso')} />;
  }

  const readFailure = (read.unavailable || read.stale) && (
    <CatalogLoadError
      // Each failure is announced again; Try again keeps its node, and the
      // focus on it, through a retry that fails again.
      failureKey={read.failureCount}
      message={[
        tSettings(
          read.stale
            ? 'enterpriseSso.refreshFailed'
            : 'enterpriseSso.loadFailed',
        ),
        failureRef.current,
      ]
        .filter(Boolean)
        .join(' ')}
      onRetry={() => void refetch()}
      isRetrying={read.retrying}
      onFocusLost={focusSection}
    />
  );

  // The form owns the page's `SettingsSection`s (title/description included)
  // so the section rhythm matches the other settings pages.
  return (
    <SettingsPage>
      {read.unavailable ? (
        <SettingsSection
          ref={sectionRef}
          tabIndex={-1}
          className="outline-none"
          title={tNav('enterpriseSso')}
        >
          {readFailure}
        </SettingsSection>
      ) : (
        // Masked in place until the connection answers, like every other
        // settings editor — not a form of empty fields that fill in later.
        // That includes a read an offline browser holds back: react-query
        // pauses it, so it is not `isLoading`. A failed refresh keeps the
        // form, and any edit in it, under its notice.
        <Skeletonize
          loading={abilityLoading || config === undefined}
          className={readFailure ? 'flex flex-col gap-8' : undefined}
        >
          {readFailure}
          <EnterpriseSsoForm
            organizationId={organizationId}
            config={config}
            sectionRef={sectionRef}
          />
        </Skeletonize>
      )}
      <TrustedHeadersSection organizationId={organizationId} />
      <EmbeddingSection organizationId={organizationId} />
    </SettingsPage>
  );
}
