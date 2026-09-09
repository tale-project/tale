'use client';

import { Link } from '@tanstack/react-router';

import { CopyableField } from '@/app/components/ui/data-display/copyable-field';
import { useOrganization } from '@/app/features/organization/hooks/queries';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { MCP_TOOL_GROUPS, MCP_TOOLS } from '@/lib/mcp/tools';
import { useSiteUrl } from '@/lib/site-url-context';

/**
 * The INBOUND MCP surface: the platform's own MCP endpoint. An MCP client (an
 * IDE, a desktop assistant, an external agent) points at the endpoint with an
 * org API key and gets the same tools the in-platform builder drives, plus the
 * organization's capability surface. The list renders `MCP_TOOLS` — the very
 * inventory the endpoint answers `tools/list` with, in the same three groups
 * the endpoint docs draw — so this section can never advertise a tool the
 * server would refuse. Lives on the API settings page with the other inbound
 * surfaces. (Managing OUTBOUND MCP servers for agents is a separate, retired
 * surface; it returns with the capability registrations.)
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

  // The REST door refuses to guess the organization for a key whose holder
  // belongs to several (400 ORG_SLUG_REQUIRED), so the example carries THIS
  // organization's slug — a copied request works for every key, not only a
  // single-organization one.
  const organization = useOrganization(organizationId);
  const orgSlug = organization.data?.slug;
  const example = `curl -X POST ${endpoint} -H 'Authorization: Bearer <api-key>' -H 'X-Organization-Slug: ${orgSlug ?? '<org-slug>'}' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

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

        {/* The tenant header. A multi-organization key must name the
            organization on every request; the slug is the value it sends. */}
        {orgSlug !== undefined && (
          <SettingsFieldRow
            label={t('mcpEndpoint.orgSlug.title')}
            description={t('mcpEndpoint.orgSlug.description')}
          >
            <CopyableField
              value={orgSlug}
              mono
              copyAriaLabel={t('mcpEndpoint.orgSlug.copy')}
            />
          </SettingsFieldRow>
        )}

        {/* The inventory in the same three groups the docs table draws —
            authoring, run & trigger management, capabilities & knowledge —
            so a reader can map this list onto the MCP endpoint docs 1:1. */}
        {MCP_TOOL_GROUPS.map((group) => (
          <SettingsFieldRow
            key={group}
            label={t(`mcpEndpoint.tools.${group}.title`)}
            description={t(`mcpEndpoint.tools.${group}.description`)}
          >
            <ul className="grid grid-cols-2 gap-1">
              {MCP_TOOLS.filter((tool) => tool.group === group).map((tool) => (
                <li key={tool.name}>
                  <code className="text-xs">{tool.name}</code>
                </li>
              ))}
            </ul>
          </SettingsFieldRow>
        ))}

        <SettingsFieldRow
          label={t('mcpEndpoint.exampleTitle')}
          description={t('mcpEndpoint.exampleHelp')}
        >
          <CopyableField
            value={example}
            mono
            copyAriaLabel={t('mcpEndpoint.copyExample')}
          />
        </SettingsFieldRow>
      </SettingsFieldList>
    </SettingsSection>
  );
}
