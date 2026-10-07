'use client';

import { Badge } from '@tale/ui/badge';
import { EntityViewDialog } from '@tale/ui/entity/entity-view-dialog';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot } from 'lucide-react';
import type { RefObject } from 'react';

import { useT } from '@/lib/i18n/client';
import { titleFromSlug } from '@/lib/shared/schemas/automation_presentation';

import {
  useProjectCapabilityCatalog,
  useProjectHarnesses,
} from '../hooks/queries';
import { useUnpinnedServingPreview } from '../hooks/use-unpinned-serving-preview';
import type { ProjectAgentDetails } from '../lib/agent-details';

/** One reading surface, compact in the timeline and complete in its dialog. */
export function ProjectAgentDetailsContent({
  agent,
  compact = false,
}: {
  agent: ProjectAgentDetails;
  compact?: boolean;
}) {
  const { t } = useT('projects');
  const roster = useProjectHarnesses(agent.organizationId).data;
  const catalog = useProjectCapabilityCatalog(
    agent.organizationId,
    agent.projectId,
  ).data;
  const unpinned = useUnpinnedServingPreview(
    'task',
    agent.model && !agent.modelProvider && !agent.managed
      ? {
          organizationId: agent.organizationId,
          model: agent.model,
          harness: agent.harness,
        }
      : undefined,
  );
  const resolved = unpinned.data?.ok === true ? unpinned.data : undefined;
  const provider = agent.modelProvider ?? resolved?.providerSlug;
  const model = roster?.models.find(
    (row) => row.id === agent.model && row.providerSlug === provider,
  );
  const providerLabel =
    model?.providerLabel ??
    roster?.models.find((row) => row.providerSlug === provider)
      ?.providerLabel ??
    provider;
  const harness =
    roster?.harnesses.find((row) => row.harness === agent.harness)?.label ??
    agent.harness;
  const facts = [
    { label: t('agents.harnessLabel'), value: harness },
    {
      label: t('agents.providerLabel'),
      value: providerLabel ?? t('agents.providerUnpinned'),
    },
    {
      label: t('agents.modelLabel'),
      value: model?.label ?? agent.model ?? t('agents.detailsUnavailable'),
    },
  ];
  const sections = [
    {
      label: t('agents.detailsSkills'),
      values: agent.skills.map(
        (slug) =>
          catalog?.skills.find((row) => row.slug === slug)?.label ??
          titleFromSlug(slug),
      ),
    },
    {
      label: t('agents.detailsConnectors'),
      values: agent.connectors.map(
        (slug) =>
          catalog?.connectors.find((row) => row.slug === slug)?.label ??
          titleFromSlug(slug),
      ),
    },
    {
      label: t('agents.detailsTools'),
      values: (agent.tools ?? []).map((name) =>
        t(`agents.tool.${name}`, { defaultValue: titleFromSlug(name) }),
      ),
    },
  ];
  return (
    <Stack gap={compact ? 2 : 4}>
      <dl className="space-y-1 text-xs">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3"
          >
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="min-w-0 wrap-anywhere">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {agent.managed ? (
        <Text variant="muted" className="text-xs">
          {t('agents.detailsStandardSnapshot')}
        </Text>
      ) : !agent.modelProvider && resolved ? (
        <Text variant="muted" className="text-xs">
          {t('agents.detailsProviderCurrently')}
        </Text>
      ) : null}
      {sections
        .filter(
          (section) =>
            !compact ||
            section.label === t('agents.detailsSkills') ||
            section.values.length > 0,
        )
        .map((section) => (
          <Stack key={section.label} gap={1}>
            <Text variant="label" className="text-xs">
              {section.label}
            </Text>
            {section.values.length === 0 ? (
              <Text variant="muted" className="text-xs">
                {t('agents.detailsNone')}
              </Text>
            ) : compact ? (
              <Text className="text-xs wrap-anywhere">
                {section.values.slice(0, 3).join(', ')}
                {section.values.length > 3
                  ? ` · ${t('agents.detailsMoreCount', { count: section.values.length - 3 })}`
                  : ''}
              </Text>
            ) : (
              <div className="flex flex-wrap gap-1">
                {section.values.map((value, index) => (
                  <Badge
                    key={`${value}-${index}`}
                    variant="outline"
                    className="max-w-full wrap-anywhere whitespace-normal"
                  >
                    {value}
                  </Badge>
                ))}
              </div>
            )}
          </Stack>
        ))}
      {!compact ? (
        <Stack gap={1}>
          <Text variant="label" className="text-xs">
            {t('agents.instructionsLabel')}
          </Text>
          <Text
            variant={agent.instructions?.trim() ? 'body' : 'muted'}
            className="text-sm wrap-anywhere whitespace-pre-wrap"
          >
            {agent.instructions?.trim() || t('agents.detailsNone')}
          </Text>
        </Stack>
      ) : null}
    </Stack>
  );
}

export function ProjectAgentDetailsDialog({
  agent,
  open,
  onOpenChange,
  restoreFocusRef,
}: {
  agent: ProjectAgentDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useT('projects');
  return (
    <EntityViewDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('agents.detailsTitle')}
      name={agent.name}
      icon={Bot}
      badges={
        agent.managed ? (
          <Badge variant="outline">{t('agents.standard.badge')}</Badge>
        ) : undefined
      }
      restoreFocusRef={restoreFocusRef}
      content={open ? <ProjectAgentDetailsContent agent={agent} /> : undefined}
    />
  );
}
