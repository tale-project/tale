'use client';

import { Link } from '@tanstack/react-router';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { METHODS } from '@/lib/engine/api/dispatch';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';

/**
 * The INBOUND MCP surface: the platform's own MCP endpoint, fronting the
 * automation engine's method table. An MCP client (an IDE, a desktop
 * assistant, an external agent) points at the endpoint with an org API key and
 * gets the same tools the in-platform builder drives — the method list
 * renders the engine's own `METHODS`, so the section can never advertise a
 * tool the executor would refuse. Lives on the Integrations page so every
 * way of connecting outside software is managed in one place. (Managing
 * OUTBOUND MCP servers for agents is a separate, retired surface; it returns
 * with the capability registrations.)
 */
export function McpEndpointSection({
  organizationId,
  className,
}: {
  organizationId: string;
  className?: string;
}) {
  const { t } = useT('settings');

  // Canonical deployment URL (SITE_URL), not the browser origin.
  const siteOrigin = useSiteUrl();
  const endpoint = `${siteOrigin}/api/v1/mcp`;

  return (
    <SettingsSection
      className={className}
      title={t('mcpEndpoint.title')}
      description={t('mcpEndpoint.description')}
    >
      {/* Same divided rows as every settings section — label + hint left,
          the value pinned right. */}
      <SettingsFieldList>
        <SettingsFieldRow
          label={t('mcpEndpoint.title')}
          description={
            <>
              {t('mcpEndpoint.authHelp')}{' '}
              <Link
                to="/dashboard/$id/settings/api/rest"
                params={{ id: organizationId }}
                className="underline"
              >
                {t('mcpEndpoint.authLink')}
              </Link>
            </>
          }
        >
          <CopyableField
            value={endpoint}
            mono
            copyAriaLabel={t('mcpEndpoint.copyEndpoint')}
          />
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('mcpEndpoint.toolsTitle')}
          description={t('mcpEndpoint.toolsHelp')}
        >
          <ul className="grid grid-cols-2 gap-1">
            {METHODS.map((method) => (
              <li key={method}>
                <code className="text-xs">{method}</code>
              </li>
            ))}
          </ul>
        </SettingsFieldRow>

        <SettingsFieldRow
          label={t('mcpEndpoint.exampleTitle')}
          description={t('mcpEndpoint.exampleHelp')}
        >
          <CopyableField
            value={`curl -X POST ${endpoint} -H 'Authorization: Bearer <api-key>' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
            mono
            copyAriaLabel={t('mcpEndpoint.copyExample')}
          />
        </SettingsFieldRow>
      </SettingsFieldList>
    </SettingsSection>
  );
}
