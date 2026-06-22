'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ExternalLink, X } from 'lucide-react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import type { OrgChartNode } from '@/convex/agents/org_chart_actions';
import { useT } from '@/lib/i18n/client';

interface AgentOption {
  slug: string;
  label: string;
}

/** A bordered, scrollable checklist of agents — the panel's edit affordance
 *  for both the incoming ("reports to") and outgoing ("delegates to") edges.
 *  Toggling stages the COMPLETE next list into the draft; nothing persists
 *  until the canvas-level Save commits a new version. */
function AgentChecklist({
  label,
  options,
  selected,
  emptyText,
  disabled,
  onChange,
}: {
  label: string;
  options: AgentOption[];
  selected: string[];
  emptyText: string;
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const toggle = (slug: string) => {
    onChange(
      selectedSet.has(slug)
        ? selected.filter((s) => s !== slug)
        : [...selected, slug],
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Text as="h3" variant="label" className="text-xs">
        {label} ({selected.length})
      </Text>
      {options.length === 0 ? (
        <Text as="p" variant="muted" className="text-xs italic">
          {emptyText}
        </Text>
      ) : (
        <div className="border-border max-h-44 overflow-y-auto rounded-md border">
          {options.map((option) => (
            <label
              key={option.slug}
              className="hover:bg-muted/50 flex cursor-pointer items-center gap-2.5 px-2.5 py-2"
            >
              <Checkbox
                checked={selectedSet.has(option.slug)}
                disabled={disabled}
                onCheckedChange={() => toggle(option.slug)}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {option.label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Side panel for the selected agent: its identity (read-only — edited on the
 * agent's settings page) plus the two editable, many-to-many delegation
 * lists. "Reports to" is the agents that delegate to this one (incoming);
 * "Delegates to" is the agents it delegates to (outgoing). Self is excluded
 * (the only forbidden edge); edits are staged into the draft and persisted
 * only when the user saves.
 */
export function OrganigramPanel({
  organizationId,
  node,
  allNodes,
  canEdit,
  isSaving,
  onSetParents,
  onSetDelegates,
  onClose,
}: {
  organizationId: string;
  node: OrgChartNode;
  allNodes: OrgChartNode[];
  canEdit: boolean;
  isSaving: boolean;
  onSetParents: (parentSlugs: string[]) => void;
  onSetDelegates: (delegateSlugs: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useT('organigram');
  const options: AgentOption[] = allNodes
    .filter((other) => other.slug !== node.slug)
    .map((other) => ({
      slug: other.slug,
      label: other.displayName || other.slug,
    }));

  return (
    <Stack
      as="aside"
      className="border-border bg-card w-72 shrink-0 overflow-y-auto border-l p-4"
    >
      <Row gap={2} align="start" justify="between">
        <div className="min-w-0">
          <Text as="h3" variant="label" className="truncate">
            {node.displayName || node.slug}
          </Text>
          <Text as="p" variant="muted" className="truncate text-xs">
            {node.slug}
          </Text>
        </div>
        <Button
          size="icon"
          variant="ghost"
          icon={X}
          title={t('panel.close')}
          onClick={onClose}
        />
      </Row>

      {node.description && (
        <Text as="p" variant="muted" className="text-sm">
          {node.description}
        </Text>
      )}

      <AgentChecklist
        label={t('panel.reportsTo')}
        options={options}
        selected={node.parentSlugs}
        emptyText={t('panel.noAgents')}
        disabled={!canEdit || isSaving}
        onChange={onSetParents}
      />

      <AgentChecklist
        label={t('panel.delegatesTo')}
        options={options}
        selected={node.directReports}
        emptyText={t('panel.noAgents')}
        disabled={!canEdit || isSaving}
        onChange={onSetDelegates}
      />

      <Text as="p" variant="muted" className="text-xs">
        {t('panel.delegationHint')}
      </Text>

      <Button asChild variant="secondary" icon={ExternalLink}>
        <Link
          to="/dashboard/$id/agents/$agentId"
          params={{ id: organizationId, agentId: node.slug }}
        >
          {t('panel.openAgent')}
        </Link>
      </Button>
    </Stack>
  );
}
