'use client';

/**
 * THE capability assembly menu — the one control every surface uses to equip
 * an agent with org skills and enabled connectors: the chat composer (per
 * conversation), the project agent dialog (per created agent), and any future
 * surface (task agents…). One component so the surfaces can never drift.
 *
 * Both groups ALWAYS render. An empty group states why it is empty
 * (`capabilities.emptySkills` / `emptyConnectors` — the connectors hint names
 * where to add a credential) instead of hiding: a silently missing group
 * reads as a bug, not as "nothing to equip". The menu only ASSEMBLES; what a
 * selection does is decided by the lane that runs the agent.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Blocks, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

/** One skill or connector on offer. */
export interface CapabilityOption {
  readonly slug: string;
  readonly label: string;
  readonly description?: string;
}

/** The assembled equipment: org skill slugs + enabled-connector slugs. */
export interface CapabilitySelection {
  readonly skills: readonly string[];
  readonly connectors: readonly string[];
}

interface CapabilityMenuProps {
  skills: readonly CapabilityOption[];
  connectors: readonly CapabilityOption[];
  value: CapabilitySelection;
  onChange: (next: CapabilitySelection) => void;
  disabled?: boolean;
  /** Trigger styling per host surface (composer sits in a ghost toolbar). */
  variant?: 'ghost' | 'secondary';
  align?: 'start' | 'end';
}

function toggle(
  values: readonly string[],
  slug: string,
  next: boolean,
): readonly string[] {
  if (next) return values.includes(slug) ? values : [...values, slug];
  return values.filter((value) => value !== slug);
}

export function CapabilityMenu({
  skills,
  connectors,
  value,
  onChange,
  disabled,
  variant = 'secondary',
  align = 'end',
}: CapabilityMenuProps) {
  // The capability vocabulary lives in the chat namespace; every surface
  // shares it so the labels can never diverge between hosts.
  const { t } = useT('chat');

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const group = (
      section: string,
      empty: string,
      options: readonly CapabilityOption[],
      selected: readonly string[],
      apply: (slugs: readonly string[]) => CapabilitySelection,
    ): DropdownMenuGroup => [
      { type: 'label', content: section },
      ...(options.length === 0
        ? [
            {
              type: 'item' as const,
              label: empty,
              disabled: true,
              onClick: () => undefined,
            },
          ]
        : options.map((option) => ({
            type: 'checkbox' as const,
            label: option.label,
            checked: selected.includes(option.slug),
            onCheckedChange: (next: boolean) =>
              onChange(apply(toggle(selected, option.slug, next))),
          }))),
    ];

    return [
      group(
        t('capabilities.sectionSkills'),
        t('capabilities.emptySkills'),
        skills,
        value.skills,
        (slugs) => ({ skills: slugs, connectors: value.connectors }),
      ),
      group(
        t('capabilities.sectionConnectors'),
        t('capabilities.emptyConnectors'),
        connectors,
        value.connectors,
        (slugs) => ({ skills: value.skills, connectors: slugs }),
      ),
    ];
  }, [skills, connectors, value, onChange, t]);

  const count = value.skills.length + value.connectors.length;

  return (
    <DropdownMenu
      align={align}
      disabled={disabled}
      trigger={
        <Button
          variant={variant}
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
