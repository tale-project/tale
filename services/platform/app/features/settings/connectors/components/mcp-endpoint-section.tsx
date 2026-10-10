'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { CopyableField } from '@tale/ui/copyable-field';
import { Link } from '@tanstack/react-router';

import { useOrganization } from '@/app/features/organization/hooks/queries';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { MCP_TOOL_GROUPS, MCP_TOOLS } from '@/lib/mcp/tools';
import { useSiteUrl } from '@/lib/site-url-context';

/** The inventory by group, in the documented order. Every group listed has
 * tools: `lib/mcp/tools.test.ts` fails on a group the inventory leaves
 * empty, so a group arrives on this page with its first tool. */
const TOOL_GROUPS = MCP_TOOL_GROUPS.map((group) => ({
  group,
  tools: MCP_TOOLS.filter((tool) => tool.group === group),
}));

/**
 * The INBOUND MCP surface: the platform's own MCP endpoint. An MCP client (an
 * IDE, a desktop assistant, an external agent) points at the endpoint with an
 * org API key and gets the same tools the in-platform builder drives, plus the
 * organization's capability surface. The list renders `MCP_TOOLS` — the very
 * inventory the endpoint answers `tools/list` with, in the same groups
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
  const orgSlug = organization.isError ? undefined : organization.data?.slug;
  const example = orgSlug
    ? `curl -X POST ${endpoint} -H 'Authorization: Bearer <api-key>' -H 'X-Organization-Slug: ${orgSlug}' -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
    : undefined;

  return (
    <SettingsSection
      className={className}
      title={t('mcpEndpoint.title')}
      description={t('mcpEndpoint.description')}
    >
      {organization.isError && (
        <Alert variant="destructive">
          <p>{t('mcpEndpoint.organizationReadFailed')}</p>
          <Button type="button" onClick={() => void organization.refetch()}>
            {t('mcpEndpoint.organizationReadRetry')}
          </Button>
        </Alert>
      )}
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

        {/* The inventory in the same groups the docs tables draw —
            authoring, run & trigger management, discovery, capabilities &
            knowledge — so a reader can map this list onto the MCP endpoint
            docs 1:1. Each list is named and described by its row, so a
            screen reader announces which group it is in. */}
        {TOOL_GROUPS.map(({ group, tools }) => (
          <SettingsFieldRow
            key={group}
            label={t(`mcpEndpoint.tools.${group}.title`)}
            description={t(`mcpEndpoint.tools.${group}.description`)}
          >
            {({ labelId, descriptionId }) => (
              // A column is as wide as a long tool name (`ch` counts in the
              // list's own monospace font), so the list takes two columns
              // only where two names fit side by side and never runs one
              // name into the next.
              <ul
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24ch),1fr))] gap-1 font-mono text-xs"
              >
                {tools.map((tool) => (
                  <li key={tool.name}>
                    <code>{tool.name}</code>
                  </li>
                ))}
              </ul>
            )}
          </SettingsFieldRow>
        ))}

        {example !== undefined && (
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
        )}
      </SettingsFieldList>
    </SettingsSection>
  );
}
