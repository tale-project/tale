'use client';

/**
 * The Automations-catalog detail panel — the `IntegrationPanel` twin for a
 * not-yet-installed automation. Opened by a catalog card click (mirrors
 * `Integrations`' card-click → `IntegrationPanel`): a Sheet previewing what
 * installing brings — the bundle's builtin views, workflows, agents, skills,
 * and required integrations (with LIVE connect state, reusing
 * `useRequiredIntegrations`) — before the operator commits. The footer's
 * Install button opens the EXISTING `AutomationInstallWizard`; its
 * preflight/override-consent flow is reused unchanged, never reimplemented
 * here. Name/description render through `useAutomationDisplay` (the
 * manifest's self-translated `i18n` block), never the raw literals.
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Row, Stack, VStack } from '@tale/ui/layout';
import {
  SectionRow,
  SectionRowBody,
  SectionRowGroup,
} from '@tale/ui/section-row';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { X } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { folderLabel } from '@/app/components/catalog/catalog-section';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { startCase } from '@/lib/utils/string';

import { useBuiltinViewTitles } from '../builtin-views/registry';
import { useAutomationDisplay } from '../hooks/use-automation-text';
import {
  type AutomationSummary,
  useBundleMemberSummaries,
} from '../hooks/use-automations';
import {
  deriveBundleInstallStatus,
  useAutomationInstallActions,
  useAutomationInstallStates,
} from '../hooks/use-install-state';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../hooks/use-required-integrations';
import { AutomationIcon, AutomationLabels } from './automation-icon';
import { AutomationInstallWizard } from './install-wizard/automation-install-wizard';
import { BundleInstallWizard } from './install-wizard/bundle-install-wizard';

interface ChipGroup {
  key: string;
  label: string;
  items: string[];
}

/** One "what it brings" chip group rendered as badges (Pages / Workflows / …). */
function ChipRow({ group }: { group: ChipGroup }) {
  return (
    <HStack gap={2} className="flex-wrap">
      {group.items.map((item, i) => (
        <Badge key={`${group.key}-${i}`} variant="outline">
          {item}
        </Badge>
      ))}
    </HStack>
  );
}

/** One bundle member row: display name + brief description (its `hidden`
 *  manifest never gets a catalog card of its own, so this IS its listing). */
function BundleMemberRow({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <VStack gap={0}>
      <Text as="span" className="text-sm font-medium">
        {name}
      </Text>
      {description && (
        <Text variant="muted" className="text-sm">
          {description}
        </Text>
      )}
    </VStack>
  );
}

/** One required-integration row: name (links to Settings → Integrations) +
 *  its live connect-state badge — the same three states `AutomationConfiguration`
 *  shows post-install, surfaced here BEFORE the operator installs. */
function RequiredIntegrationRow({
  organizationId,
  item,
}: {
  organizationId: string;
  item: RequiredIntegration;
}) {
  const { t } = useT('automations');
  return (
    <HStack gap={3} className="items-center justify-between">
      <Link
        to="/dashboard/$id/settings/integrations"
        params={{ id: organizationId }}
        search={{ slug: item.slug }}
        className="min-w-0 truncate text-sm font-medium hover:underline"
      >
        {item.integration.title}
      </Link>
      {item.connected ? (
        <Badge variant="green" dot>
          {t('configuration.status.connected')}
        </Badge>
      ) : item.exists ? (
        <Badge variant="yellow" dot>
          {t('configuration.status.notConnected')}
        </Badge>
      ) : (
        <Badge variant="destructive">{t('configuration.status.missing')}</Badge>
      )}
    </HStack>
  );
}

interface AutomationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  automation: AutomationSummary;
  /** A private (uploaded) automation — earns a "Private" badge (built-in catalog
   *  automations don't). */
  isPrivate: boolean;
}

export function AutomationPanel({
  open,
  onOpenChange,
  organizationId,
  automation,
  isPrivate,
}: AutomationPanelProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const display = useAutomationDisplay()(automation);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Flipped once the wizard reports the install committed. Dismissing or
  // finishing the wizard then also closes this preview panel — otherwise it
  // lingers behind the closed wizard with an "Install" button over an
  // already-installed automation (a confusing re-install trap).
  const [installed, setInstalled] = useState(false);
  const handleWizardOpenChange = (next: boolean) => {
    setWizardOpen(next);
    if (!next && installed) onOpenChange(false);
  };
  const isBundle = automation.kind === 'bundle';

  // A bundle carries no install row of its own — its state derives from its
  // members'. Reactive, so the heading and footer flip the moment a wizard
  // commit or an uninstall lands.
  const { bySlug: installStates } = useAutomationInstallStates(organizationId);
  const bundleInstalled =
    isBundle &&
    deriveBundleInstallStatus(automation.members ?? [], installStates) !==
      'not-installed';
  const { uninstallBundle, isPending: uninstallPending } =
    useAutomationInstallActions(organizationId);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const handleUninstallBundle = async () => {
    try {
      await uninstallBundle(automation.slug);
      toast({ title: t('install.bundleUninstalled'), variant: 'success' });
    } catch (error) {
      console.error(error);
      toast({
        title: t('install.bundleUninstallFailed'),
        variant: 'destructive',
      });
    } finally {
      setUninstallOpen(false);
    }
  };

  const builtinViewTitles = useBuiltinViewTitles(automation.builtinViews);
  // A bundle's members are HIDDEN (no catalog card/chip data of their own —
  // `automation.workflows`/`agents`/`skills` are empty on the bundle manifest
  // itself). This is their only pre-install "what's inside" read.
  const { members: bundleMembers } = useBundleMemberSummaries(
    organizationId,
    isBundle ? (automation.members ?? []) : [],
  );
  // A bundle manifest declares no `requires.integrations` of its own — its
  // Integrations section is the deduped union of its members' requirements.
  const memberIntegrationSlugs = useMemo(
    () => [...new Set(bundleMembers.flatMap((m) => m.requiredIntegrations))],
    [bundleMembers],
  );
  const { required } = useRequiredIntegrations(
    organizationId,
    isBundle ? memberIntegrationSlugs : automation.requiredIntegrations,
  );

  const chipGroups: ChipGroup[] = [
    {
      key: 'pages',
      label: t('panel.sections.pages'),
      items: builtinViewTitles,
    },
    {
      key: 'workflows',
      label: t('panel.sections.workflows'),
      items: automation.workflows.map(startCase),
    },
    {
      key: 'agents',
      label: t('panel.sections.agents'),
      items: automation.agents.map(startCase),
    },
    {
      key: 'skills',
      label: t('panel.sections.skills'),
      items: automation.skills.map(startCase),
    },
    // A bundle's own manifest carries no workflows/agents/skills (it only
    // aggregates its members' installs) — the members section below is its
    // "what will be installed" instead of these chips.
  ].filter((group) => !isBundle && group.items.length > 0);

  // Compose the "what will be installed" preview as the same collapsible
  // section list the integration panel uses. Each entry becomes a `SectionRow`.
  const sections: Array<{
    key: string;
    label: string;
    count?: number;
    body: ReactNode;
  }> = [
    ...chipGroups.map((group) => ({
      key: group.key,
      label: group.label,
      count: group.items.length,
      body: <ChipRow group={group} />,
    })),
    ...(bundleMembers.length > 0
      ? [
          {
            key: 'members',
            label: t('panel.sections.members'),
            count: bundleMembers.length,
            body: (
              <VStack gap={3}>
                {bundleMembers.map((member) => (
                  <BundleMemberRow
                    key={member.slug}
                    name={member.name}
                    description={member.description}
                  />
                ))}
              </VStack>
            ),
          },
        ]
      : []),
    ...(required.length > 0
      ? [
          {
            key: 'integrations',
            label: t('panel.sections.integrations'),
            count: required.length,
            body: (
              <VStack gap={2}>
                {required.map((item) => (
                  <RequiredIntegrationRow
                    key={item.slug}
                    organizationId={organizationId}
                    item={item}
                  />
                ))}
              </VStack>
            ),
          },
        ]
      : []),
    ...(automation.folder
      ? [
          {
            key: 'folder',
            label: t('panel.sections.folder'),
            body: (
              <Badge variant="outline">
                {folderLabel(t, automation.folder)}
              </Badge>
            ),
          },
        ]
      : []),
  ];

  // Sections start expanded (unlike the integration panel's long
  // operations/connector-code lists) so the install preview reads at a glance;
  // track the COLLAPSED set so any section shown later still defaults open.
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('panel.title')}
      size="md"
      hideClose
      className="flex flex-col gap-0 overflow-y-hidden p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {t('panel.title')}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => onOpenChange(false)}
        />
      </HStack>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        <Stack gap={6}>
          <HStack gap={3} className="items-start">
            <Row
              gap={0}
              justify="center"
              className="bg-muted text-muted-foreground size-10 shrink-0 rounded-lg"
            >
              <AutomationIcon automation={automation} className="size-5" />
            </Row>
            <VStack gap={1} className="min-w-0">
              <Text as="span" className="text-sm font-medium">
                {display.name}
              </Text>
              <HStack gap={2} className="flex-wrap items-center">
                <Badge variant="slate">
                  {t(
                    automation.scope === 'project'
                      ? 'details.scopeProject'
                      : 'details.scopeOrg',
                  )}
                </Badge>
                <AutomationLabels labels={automation.labels} />
                {isPrivate && <Badge variant="outline">{t('private')}</Badge>}
              </HStack>
            </VStack>
          </HStack>

          <Text variant="muted" className="text-sm leading-relaxed">
            {display.description || t('install.notInstalledDescription')}
          </Text>

          {sections.length > 0 && (
            <Stack gap={3}>
              <Text className="font-medium">
                {t(
                  bundleInstalled
                    ? 'panel.whatsInstalled'
                    : 'panel.whatWillBeInstalled',
                )}
              </Text>
              <SectionRowGroup>
                {sections.map((section, index) => (
                  <SectionRow
                    key={section.key}
                    label={section.label}
                    badge={
                      section.count != null ? (
                        <Badge variant="outline" className="text-xs">
                          {section.count}
                        </Badge>
                      ) : undefined
                    }
                    expanded={!collapsed.has(section.key)}
                    onToggle={() => toggleSection(section.key)}
                    isLast={index === sections.length - 1}
                  >
                    <SectionRowBody>{section.body}</SectionRowBody>
                  </SectionRow>
                ))}
              </SectionRowGroup>
            </Stack>
          )}
        </Stack>
      </div>

      <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
        <HStack justify="end" align="center" gap={2}>
          {bundleInstalled ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setUninstallOpen(true)}
                disabled={uninstallPending}
              >
                {t('install.uninstall')}
              </Button>
              <Button onClick={() => setWizardOpen(true)}>
                {t('install.reinstall')}
              </Button>
            </>
          ) : (
            <Button onClick={() => setWizardOpen(true)}>
              {t('panel.install')}
            </Button>
          )}
        </HStack>
      </div>

      {isBundle && (
        <DeleteDialog
          open={uninstallOpen}
          onOpenChange={setUninstallOpen}
          title={t('install.uninstallBundleTitle')}
          description={t('install.uninstallBundleDescription', {
            count: (automation.members ?? []).length,
          })}
          preview={{ primary: display.name }}
          warning={t('install.uninstallWarning')}
          deleteText={t('install.uninstallBundle')}
          isDeleting={uninstallPending}
          onDelete={() => void handleUninstallBundle()}
        />
      )}

      {isBundle ? (
        <BundleInstallWizard
          open={wizardOpen}
          onOpenChange={handleWizardOpenChange}
          onInstalled={() => setInstalled(true)}
          organizationId={organizationId}
          bundleSlug={automation.slug}
          bundleName={display.name}
          scope={automation.scope}
        />
      ) : (
        <AutomationInstallWizard
          open={wizardOpen}
          onOpenChange={handleWizardOpenChange}
          onInstalled={() => setInstalled(true)}
          organizationId={organizationId}
          automationSlug={automation.slug}
          automationName={display.name}
          scope={automation.scope}
          requiredIntegrations={automation.requiredIntegrations}
        />
      )}
    </Sheet>
  );
}
