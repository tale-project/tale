'use client';

/**
 * A project's per-agent capability assembly: the skills and connectors one
 * fixed agent (a third-party harness) is equipped with IN THIS PROJECT.
 *
 * The persistent, project-scoped analog of the chat composer's capability
 * menu — same two-checkbox-group shape, but the selection is a plain
 * `{ skills, connectors }` binding persisted on the project rather than a chat
 * turn's per-conversation assembly. Empty groups say so plainly instead of
 * hiding, so "nothing to equip" is a visible fact.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Blocks, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

/** One skill or connector the project can equip an agent with. */
export interface CapabilityOption {
  slug: string;
  label: string;
  description?: string;
}

/** The binding a project holds for one agent. */
export interface AgentCapabilityBinding {
  skills: readonly string[];
  connectors: readonly string[];
}

interface ProjectAgentCapabilityMenuProps {
  skills: readonly CapabilityOption[];
  connectors: readonly CapabilityOption[];
  value: AgentCapabilityBinding;
  onChange: (next: AgentCapabilityBinding) => void;
  disabled?: boolean;
}

function toggle(
  values: readonly string[],
  slug: string,
  next: boolean,
): string[] {
  if (next) return values.includes(slug) ? [...values] : [...values, slug];
  return values.filter((value) => value !== slug);
}

export function ProjectAgentCapabilityMenu({
  skills,
  connectors,
  value,
  onChange,
  disabled,
}: ProjectAgentCapabilityMenuProps) {
  // The capability-menu vocabulary is shared with the chat composer.
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
            checked: value.skills.includes(skill.slug),
            onCheckedChange: (next: boolean) =>
              onChange({
                skills: toggle(value.skills, skill.slug, next),
                connectors: [...value.connectors],
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
            checked: value.connectors.includes(connector.slug),
            onCheckedChange: (next: boolean) =>
              onChange({
                skills: [...value.skills],
                connectors: toggle(value.connectors, connector.slug, next),
              }),
          }))),
    ];

    return [skillGroup, connectorGroup];
  }, [skills, connectors, value, onChange, t]);

  const count = value.skills.length + value.connectors.length;

  return (
    <DropdownMenu
      align="end"
      disabled={disabled}
      trigger={
        <Button
          variant="secondary"
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
