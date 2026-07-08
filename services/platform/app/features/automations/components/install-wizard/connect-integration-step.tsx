'use client';

import { Text } from '@tale/ui/text';
import { useEffect, useState } from 'react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { ConnectIntegrationPanel } from '@/app/features/settings/integrations/components/integration-manage/connect-integration-panel';
import { useT } from '@/lib/i18n/client';

import { useOAuth2PopupConnect } from '../../hooks/use-oauth2-popup-connect';
import type { RequiredIntegration } from '../../hooks/use-required-integrations';

/**
 * One wizard step that connects a single required integration. Reuses the
 * settings connect panel; gates the step's validity on the integration becoming
 * connected (so Next enables once done), stays `optional` so the user can skip
 * and finish later, and routes OAuth integrations through a popup instead of a
 * full-page redirect that would tear the wizard down.
 */
export function ConnectIntegrationStep({
  required,
  organizationId,
  onConnectedChange,
}: {
  required: RequiredIntegration;
  organizationId: string;
  /** Report the live connect state up so the wizard's Done screen can tell a
   *  genuinely-connected required integration from a skipped one — the reactive
   *  required-integrations query can lag an in-wizard connect. */
  onConnectedChange: (slug: string, connected: boolean) => void;
}) {
  const { t } = useT('automations');
  const popup = useOAuth2PopupConnect();
  const [connected, setConnected] = useState(required.connected);
  const stepId = `connect-${required.slug}`;

  useEffect(() => {
    onConnectedChange(required.slug, connected);
  }, [required.slug, connected, onConnectedChange]);

  if (!required.exists) {
    // The definition isn't in the org (a newer builtin not yet scaffolded) — we
    // can't render a credential form. Let the user skip and resolve it later.
    return (
      <WizardStep id={stepId} valid>
        <Text variant="muted" className="text-sm">
          {t('installWizard.integrationUnavailable', {
            integration: required.slug,
          })}
        </Text>
      </WizardStep>
    );
  }

  return (
    <WizardStep id={stepId} valid={connected}>
      <ConnectIntegrationPanel
        integration={required.integration}
        organizationId={organizationId}
        onConnected={() => {
          popup.close();
          setConnected(true);
        }}
        onOAuthAuthorize={(prepareUrl) => void popup.authorize(prepareUrl)}
      />
    </WizardStep>
  );
}
