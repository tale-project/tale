import { Text } from '@tale/ui/text';
import { createFileRoute, Link } from '@tanstack/react-router';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { METHODS } from '@/lib/engine/api/dispatch';
import { useT } from '@/lib/i18n/client';
import { useSiteUrl } from '@/lib/site-url-context';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/mcp')({
  head: () => ({ meta: seo('mcpServers') }),
  component: ApiMcpPage,
});

/**
 * The INBOUND MCP surface: the platform's own MCP endpoint, fronting the
 * automation engine's method table. An MCP client (an IDE, a desktop
 * assistant, a coding agent) points at the endpoint with an org API key and
 * gets the same twelve tools the in-platform builder drives — the method
 * list below renders the engine's own `METHODS`, so the page can never
 * advertise a tool the executor would refuse. (Managing OUTBOUND MCP servers
 * for agents is a separate, retired surface; it returns with the capability
 * registrations.)
 */
function ApiMcpPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tNav } = useT('navigation');

  // Canonical deployment URL (SITE_URL), not the browser origin.
  const siteOrigin = useSiteUrl();
  const endpoint = `${siteOrigin}/api/v1/mcp`;

  // Access is gated by the parent `api` route layout.
  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('mcp')}
        description={t('mcpEndpoint.description')}
      >
        <div className="max-w-xl">
          <CopyableField
            value={endpoint}
            mono
            copyAriaLabel={t('mcpEndpoint.copyEndpoint')}
          />
        </div>
        <Text as="p" variant="muted" className="max-w-xl text-sm">
          {t('mcpEndpoint.authHelp')}{' '}
          <Link
            to="/dashboard/$id/settings/api/rest"
            params={{ id: organizationId }}
            className="underline"
          >
            {t('mcpEndpoint.authLink')}
          </Link>
        </Text>
      </SettingsSection>

      <SettingsSection
        title={t('mcpEndpoint.toolsTitle')}
        description={t('mcpEndpoint.toolsHelp')}
      >
        <ul className="grid max-w-xl grid-cols-2 gap-1 sm:grid-cols-3">
          {METHODS.map((method) => (
            <li key={method}>
              <code className="text-xs">{method}</code>
            </li>
          ))}
        </ul>
      </SettingsSection>

      <SettingsSection
        title={t('mcpEndpoint.exampleTitle')}
        description={t('mcpEndpoint.exampleHelp')}
      >
        <div className="max-w-xl">
          <CopyableField
            value={`curl -X POST ${endpoint} -H 'Authorization: Bearer <api-key>' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
            mono
            copyAriaLabel={t('mcpEndpoint.copyExample')}
          />
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
