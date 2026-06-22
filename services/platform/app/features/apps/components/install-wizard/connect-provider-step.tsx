'use client';

import { useState } from 'react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { ConnectProviderPanel } from '@/app/features/settings/providers/components/connect-provider-panel';

import type { RequiredProvider } from '../../hooks/use-app-agent-readiness';

/**
 * One wizard step that connects a single provider's API key (deduped across all
 * agents needing it). Gates validity on a local "connected" flag set when the
 * key is saved, so the step doesn't vanish from under the user after connecting.
 */
export function ConnectProviderStep({
  provider,
  organizationId,
}: {
  provider: RequiredProvider;
  organizationId: string;
}) {
  const [connected, setConnected] = useState(false);
  return (
    <WizardStep id={`provider-${provider.name}`} valid={connected}>
      <ConnectProviderPanel
        organizationId={organizationId}
        providerName={provider.name}
        {...(provider.displayName !== undefined && {
          displayName: provider.displayName,
        })}
        {...(provider.baseUrl !== undefined && { baseUrl: provider.baseUrl })}
        onConnected={() => setConnected(true)}
      />
    </WizardStep>
  );
}
