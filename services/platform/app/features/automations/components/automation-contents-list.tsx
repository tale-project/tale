'use client';

/**
 * The "what's inside an automation" section list — the collapsible
 * Pages / Workflows / Agents / Skills / Members / Integrations / Folder
 * breakdown. Rendered in the pre-install `AutomationPanel` AND, as its mirror,
 * inside the uninstall confirmation dialogs: "Uninstall bundle?" lists exactly
 * what tearing a bundle down removes, the same way the install preview lists
 * what it adds. Extracted from `AutomationPanel` so both surfaces render the
 * one shape.
 */
import { Badge } from '@tale/ui/badge';
import { HStack, Stack, VStack } from '@tale/ui/layout';
import {
  SectionRow,
  SectionRowBody,
  SectionRowGroup,
} from '@tale/ui/section-row';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useMemo, useState } from 'react';

import { folderLabel } from '@/app/components/catalog/catalog-section';
import { useT } from '@/lib/i18n/client';
import { startCase } from '@/lib/utils/string';

import { useBuiltinViewTitles } from '../builtin-views/registry';
import {
  type AutomationSummary,
  useBundleMemberSummaries,
} from '../hooks/use-automations';
import {
  type RequiredIntegration,
  useRequiredIntegrations,
} from '../hooks/use-required-integrations';

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
 *  its live connect-state badge. */
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

export function AutomationContentsList({
  organizationId,
  automation,
  heading,
}: {
  organizationId: string;
  automation: AutomationSummary;
  /** The section-group heading (e.g. "What will be installed" / "This removes"). */
  heading: string;
}) {
  const { t } = useT('automations');
  const isBundle = automation.kind === 'bundle';

  const builtinViewTitles = useBuiltinViewTitles(automation.builtinViews);
  // A bundle's members are HIDDEN (no catalog card/chip data of their own —
  // `automation.workflows`/`agents`/`skills` are empty on the bundle manifest
  // itself). This is their only "what's inside" read.
  const { members: bundleMembers, isLoading: membersLoading } =
    useBundleMemberSummaries(
      organizationId,
      isBundle ? (automation.members ?? []) : [],
    );
  // A bundle manifest declares no `requires.integrations` of its own — its
  // Integrations section is the deduped union of its members' requirements.
  const memberIntegrationSlugs = useMemo(
    () => [...new Set(bundleMembers.flatMap((m) => m.requiredIntegrations))],
    [bundleMembers],
  );
  const { required, isLoading: requiredLoading } = useRequiredIntegrations(
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

  // Sections start expanded so the preview reads at a glance; track the
  // COLLAPSED set so any section shown later still defaults open.
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A bundle's sections are fully async (members + their integrations), so an
  // empty list mid-load means "still loading", not "nothing inside" — mask a
  // few placeholder rows rather than popping the real rows in once they resolve.
  if (sections.length === 0) {
    const loading = (isBundle && membersLoading) || requiredLoading;
    if (!loading) return null;
    return (
      <Stack gap={3}>
        <Text className="font-medium">{heading}</Text>
        <Skeletonize loading className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <SkeletonBox key={i} fullWidth>
              <div className="h-11 w-full rounded-md" />
            </SkeletonBox>
          ))}
        </Skeletonize>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <Text className="font-medium">{heading}</Text>
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
  );
}
