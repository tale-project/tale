'use client';

import { CodingAgentSetup } from '@/app/features/coding-agent/components/coding-agent-setup';
import { SetupGuideLink } from '@/app/features/coding-agent/components/setup-dialog-footer';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';
import { useT } from '@/lib/i18n/client';

/**
 * The way to connect a coding agent, on the page that holds the MCP address:
 * the guided setup the Connected agents page opens in a dialog — the commands
 * for the agent in use, whether it has signed in yet, and what to say to it
 * first — as the page's first section. It appears only where the deployment
 * lets agents sign in and this person may connect one; elsewhere the page
 * stays what it was, the address and the key.
 */
export function McpConnectSection({
  organizationId,
  className,
}: {
  organizationId: string;
  className?: string;
}) {
  const { t } = useT('settings');
  const { connectAgents } = useApiSettingsAccess(organizationId);
  if (!connectAgents) return null;
  return (
    <SettingsSection
      className={className}
      title={t('mcpConnect.title')}
      description={t('mcpConnect.description')}
    >
      <CodingAgentSetup
        organizationId={organizationId}
        promptContext={{ kind: 'general' }}
      >
        <div>
          <SetupGuideLink />
        </div>
      </CodingAgentSetup>
    </SettingsSection>
  );
}
