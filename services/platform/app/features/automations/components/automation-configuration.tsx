'use client';

/**
 * The "Configuration" tab of an installed automation. Leads with the
 * automation's own name + description (read-only display; an editable
 * override is a separate follow-up), then its control-panel sections in
 * order: Agents (readiness rows, falling back to the manifest cast),
 * Workflows, Skills, and required Integrations — each row linking to the
 * resource's own management surface. Empty sections hide; a bare automation
 * (nothing declared at all) gets a localized empty state below the name/
 * description block, which always renders.
 *
 * The Workflows section leads with a dismissible info notice: a workflow is
 * write-once on reinstall/sync (`install_fs.ts`'s `isWorkflowShellPath`) — the
 * same notice appears contextually in the reinstall confirm dialog
 * (`use-reinstall-with-preflight.tsx`).
 */
import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Bot, Plug, Sparkles, Workflow, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { startCase } from '@/lib/utils/string';
import { getSlugBaseName, slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useAutomationAgentReadiness } from '../hooks/use-automation-agent-readiness';
import { useAutomationDisplay } from '../hooks/use-automation-text';
import type { AutomationSummary } from '../hooks/use-automations';
import { useRequiredIntegrations } from '../hooks/use-required-integrations';

/** A labelled group of resource rows; hidden entirely when it has no rows. */
function ConfigurationSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <VStack gap={2}>
      <Text className="font-medium">{title}</Text>
      <VStack gap={2}>{children}</VStack>
    </VStack>
  );
}

/**
 * One resource row — the membership-hub card anatomy: a kind icon, the name
 * as the row's link, the slug muted underneath, a status badge on the right.
 */
function ConfigurationRow({
  icon: Icon,
  link,
  slug,
  badge,
}: {
  icon: LucideIcon;
  /** The row's name, already wrapped in its `<Link>`. */
  link: ReactNode;
  slug: string;
  badge?: ReactNode;
}) {
  return (
    <Card className="py-3">
      <HStack className="items-center justify-between gap-3">
        <HStack gap={3} className="min-w-0 items-center">
          <Icon
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
          <VStack gap={0} className="min-w-0">
            {link}
            <Text variant="muted" className="truncate text-sm">
              {slug}
            </Text>
          </VStack>
        </HStack>
        {badge}
      </HStack>
    </Card>
  );
}

/** Name + description, read-only — the automation's own identity, always
 *  shown at the top of Configuration regardless of what else it declares. */
function IdentitySection({ automation }: { automation: AutomationSummary }) {
  const { t } = useT('automations');
  const display = useAutomationDisplay()(automation);
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Text variant="muted" className="text-sm">
          {t('configuration.nameLabel')}
        </Text>
        <Text>{display.name}</Text>
      </VStack>
      {display.description && (
        <VStack gap={1}>
          <Text variant="muted" className="text-sm">
            {t('configuration.descriptionLabel')}
          </Text>
          <Text>{display.description}</Text>
        </VStack>
      )}
    </VStack>
  );
}

const rowLinkClass = 'min-w-0 truncate font-medium hover:underline';

export function AutomationConfiguration({
  organizationId,
  automationSlug,
  automation,
}: {
  organizationId: string;
  automationSlug: string;
  automation: AutomationSummary;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { agents: agentReadiness } = useAutomationAgentReadiness(
    organizationId,
    automationSlug,
  );
  const { required } = useRequiredIntegrations(
    organizationId,
    automation.requiredIntegrations,
  );
  const [workflowNoticeDismissed, setWorkflowNoticeDismissed] = useState(false);

  // Readiness rows carry display names + per-agent status; until they load
  // (or when the action yields nothing), fall back to the manifest cast so
  // the section never blanks for an automation that declares agents.
  const agentRows =
    agentReadiness.length > 0
      ? agentReadiness.map((agent) => ({
          slug: agent.agentSlug,
          name: agent.displayName,
          badge: agent.ready ? (
            <Badge variant="green">{t('configuration.status.ready')}</Badge>
          ) : (
            <Badge variant="yellow">
              {t('configuration.status.needsSetup')}
            </Badge>
          ),
        }))
      : automation.agents.map((slug) => ({
          slug,
          name: startCase(slug),
          badge: undefined,
        }));

  const isEmpty =
    agentRows.length === 0 &&
    automation.workflows.length === 0 &&
    automation.skills.length === 0 &&
    required.length === 0;

  return (
    <VStack gap={6}>
      <IdentitySection automation={automation} />

      {isEmpty ? (
        <EmptyState title={t('configuration.empty')} />
      ) : (
        <>
          {agentRows.length > 0 && (
            <ConfigurationSection title={t('configuration.agentsTitle')}>
              {agentRows.map((agent) => (
                <ConfigurationRow
                  key={agent.slug}
                  icon={Bot}
                  slug={agent.slug}
                  badge={agent.badge}
                  link={
                    <Link
                      to="/dashboard/$id/agents/$agentId"
                      params={{ id: organizationId, agentId: agent.slug }}
                      className={rowLinkClass}
                    >
                      {agent.name}
                    </Link>
                  }
                />
              ))}
            </ConfigurationSection>
          )}

          {automation.workflows.length > 0 && (
            <ConfigurationSection title={t('configuration.workflowsTitle')}>
              {!workflowNoticeDismissed && (
                <div className="relative">
                  <Alert
                    variant="info"
                    title={t('configuration.workflowUpdateExemptTitle')}
                    description={t(
                      'configuration.workflowUpdateExemptDescription',
                    )}
                    className="pr-10"
                  />
                  <IconButton
                    icon={X}
                    aria-label={tCommon('aria.dismiss')}
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => setWorkflowNoticeDismissed(true)}
                  />
                </div>
              )}
              {automation.workflows.map((slug) => (
                <ConfigurationRow
                  key={slug}
                  icon={Workflow}
                  slug={slug}
                  link={
                    <Link
                      to="/dashboard/$id/workflows/$workflowId"
                      params={{
                        id: organizationId,
                        workflowId: slugToUrlParam(slug),
                      }}
                      className={rowLinkClass}
                    >
                      {startCase(getSlugBaseName(slug))}
                    </Link>
                  }
                />
              ))}
            </ConfigurationSection>
          )}

          {automation.skills.length > 0 && (
            <ConfigurationSection title={t('configuration.skillsTitle')}>
              {automation.skills.map((slug) => (
                <ConfigurationRow
                  key={slug}
                  icon={Sparkles}
                  slug={slug}
                  link={
                    <Link
                      to="/dashboard/$id/settings/skills"
                      params={{ id: organizationId }}
                      search={{ slug }}
                      className={rowLinkClass}
                    >
                      {startCase(slug)}
                    </Link>
                  }
                />
              ))}
            </ConfigurationSection>
          )}

          {required.length > 0 && (
            <ConfigurationSection title={t('configuration.integrationsTitle')}>
              {required.map((item) => (
                <ConfigurationRow
                  key={item.slug}
                  icon={Plug}
                  slug={item.slug}
                  badge={
                    item.connected ? (
                      <Badge variant="green" dot>
                        {t('configuration.status.connected')}
                      </Badge>
                    ) : item.exists ? (
                      <Badge variant="yellow" dot>
                        {t('configuration.status.notConnected')}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        {t('configuration.status.missing')}
                      </Badge>
                    )
                  }
                  link={
                    <Link
                      to="/dashboard/$id/settings/integrations"
                      params={{ id: organizationId }}
                      search={{ slug: item.slug }}
                      className={rowLinkClass}
                    >
                      {item.integration.title}
                    </Link>
                  }
                />
              ))}
            </ConfigurationSection>
          )}
        </>
      )}
    </VStack>
  );
}
