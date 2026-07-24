'use client';

/**
 * The conversation's capability assembly: which org skills and enabled
 * connectors the picked agent is equipped with.
 *
 * Offered for third-party coding agents — their capabilities are provisioned
 * into the sandbox session (skills staged as files, connectors bridged), so
 * no model tool-loop is involved. The menu only ASSEMBLES; what a selection
 * does is decided by the lane that runs the agent. Empty groups say so
 * plainly instead of hiding, so "nothing to equip" is a visible fact.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Blocks, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import type { ComposerCapabilityOption, ComposerSelection } from '../types';

interface ComposerCapabilityMenuProps {
  skills: readonly ComposerCapabilityOption[];
  connectors: readonly ComposerCapabilityOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}

function toggle(
  values: readonly string[],
  slug: string,
  next: boolean,
): readonly string[] {
  if (next) return values.includes(slug) ? values : [...values, slug];
  return values.filter((value) => value !== slug);
}

export function ComposerCapabilityMenu({
  skills,
  connectors,
  selection,
  onSelectionChange,
  disabled,
}: ComposerCapabilityMenuProps) {
  const { t } = useT('chat');

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const skillGroup: DropdownMenuGroup = [
      { type: 'label', content: t('capabilities.sectionSkills') },
      ...(skills.length === 0
        ? [
            {
              type: 'item' as const,
              label: t('capabilities.emptySkills'),
              disabled: true,
              onClick: () => undefined,
            },
          ]
        : skills.map((skill) => ({
            type: 'checkbox' as const,
            label: skill.label,
            checked: selection.skills.includes(skill.slug),
            onCheckedChange: (next: boolean) =>
              onSelectionChange({
                ...selection,
                skills: toggle(selection.skills, skill.slug, next),
              }),
          }))),
    ];

    const connectorGroup: DropdownMenuGroup = [
      { type: 'label', content: t('capabilities.sectionConnectors') },
      ...(connectors.length === 0
        ? [
            {
              type: 'item' as const,
              label: t('capabilities.emptyConnectors'),
              disabled: true,
              onClick: () => undefined,
            },
          ]
        : connectors.map((connector) => ({
            type: 'checkbox' as const,
            label: connector.label,
            checked: selection.connectors.includes(connector.slug),
            onCheckedChange: (next: boolean) =>
              onSelectionChange({
                ...selection,
                connectors: toggle(selection.connectors, connector.slug, next),
              }),
          }))),
    ];

    return [skillGroup, connectorGroup];
  }, [skills, connectors, selection, onSelectionChange, t]);

  const count = selection.skills.length + selection.connectors.length;

  return (
    <DropdownMenu
      align="start"
      disabled={disabled}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('capabilities.label')}
          aria-haspopup="menu"
          className="min-w-0"
        >
          <Blocks aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {count > 0
              ? t('capabilities.labelWithCount', { count })
              : t('capabilities.label')}
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
