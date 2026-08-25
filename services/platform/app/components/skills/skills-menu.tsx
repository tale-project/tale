'use client';

/**
 * THE capability assembly menu — the one control every surface uses to equip
 * an agent with org skills, enabled connectors, and platform tools: the
 * project agent dialog (per created agent) and any future surface. One
 * component so the surfaces can never drift.
 *
 * Every group ALWAYS renders. An empty group states why it is empty
 * (`skills.emptySkills` / `emptyConnectors` — the connectors hint names
 * where to add a credential) instead of hiding: a silently missing group
 * reads as a bug, not as "nothing to equip". The menu only ASSEMBLES; what a
 * selection does is decided by the lane that runs the agent.
 */

import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Blocks, ChevronDown } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';

import { FieldShell } from '@/app/components/ui/forms/field-shell';
import { Label } from '@/app/components/ui/forms/label';
import { useT } from '@/lib/i18n/client';

/** One skill, connector, or tool on offer. */
export interface SkillOption {
  readonly slug: string;
  readonly label: string;
  readonly description?: string;
  /** Optional sub-category header this option sorts under within its section
   * — the platform tools set it to their module (Tasks, Documents, …) so the
   * picker groups them instead of showing one flat list. Options with no
   * `group` render directly under the section label. */
  readonly group?: string;
}

/** The assembled equipment: org skill slugs + enabled-connector slugs +
 * granted platform-tool names. */
export interface SkillsSelection {
  readonly skills: readonly string[];
  readonly connectors: readonly string[];
  readonly tools: readonly string[];
}

interface SkillsMenuProps {
  skills: readonly SkillOption[];
  connectors: readonly SkillOption[];
  /** Grantable platform tools (task/document reads and writes). */
  tools: readonly SkillOption[];
  value: SkillsSelection;
  onChange: (next: SkillsSelection) => void;
  disabled?: boolean;
  /** Trigger styling per host surface (composer sits in a ghost toolbar). */
  variant?: 'ghost' | 'secondary';
  align?: 'start' | 'end';
  /** Field label — same Label chrome as Input/Select. Omit only for unlabeled toolbars. */
  label?: string;
  description?: ReactNode;
}

function toggle(
  values: readonly string[],
  slug: string,
  next: boolean,
): readonly string[] {
  if (next) return values.includes(slug) ? values : [...values, slug];
  return values.filter((value) => value !== slug);
}

export function SkillsMenu({
  skills,
  connectors,
  tools,
  value,
  onChange,
  disabled,
  variant = 'secondary',
  align = 'end',
  label,
  description,
}: SkillsMenuProps) {
  // The capability vocabulary lives in the chat namespace; every surface
  // shares it so the labels can never diverge between hosts.
  const { t } = useT('chat');
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const descriptionId = `${fieldId}-description`;

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const checkbox = (
      option: SkillOption,
      selected: readonly string[],
      apply: (slugs: readonly string[]) => SkillsSelection,
    ) => ({
      type: 'checkbox' as const,
      label: option.label,
      checked: selected.includes(option.slug),
      onCheckedChange: (next: boolean) =>
        onChange(apply(toggle(selected, option.slug, next))),
    });

    const group = (
      section: string,
      empty: string,
      options: readonly SkillOption[],
      selected: readonly string[],
      apply: (slugs: readonly string[]) => SkillsSelection,
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
        : options.map((option) => checkbox(option, selected, apply))),
    ];

    // The tools section, sub-grouped by each option's `group` (its module):
    // one label per distinct module, in first-seen order, so the picker reads
    // as Tasks / Documents / Knowledge / … instead of one flat list. Tools
    // with no `group` fall under the generic section label.
    const toolGroups = (): DropdownMenuGroup[] => {
      if (tools.length === 0) {
        return [
          group(
            t('skills.sectionTools'),
            t('skills.emptyTools'),
            tools,
            value.tools,
            (slugs) => ({ ...value, tools: slugs }),
          ),
        ];
      }
      const apply = (slugs: readonly string[]): SkillsSelection => ({
        ...value,
        tools: slugs,
      });
      const order: string[] = [];
      const byGroup = new Map<string, SkillOption[]>();
      for (const option of tools) {
        const key = option.group ?? t('skills.sectionTools');
        if (!byGroup.has(key)) {
          byGroup.set(key, []);
          order.push(key);
        }
        byGroup.get(key)?.push(option);
      }
      return order.map((key): DropdownMenuGroup => {
        const header: DropdownMenuGroup = [{ type: 'label', content: key }];
        return header.concat(
          (byGroup.get(key) ?? []).map((option) =>
            checkbox(option, value.tools, apply),
          ),
        );
      });
    };

    return [
      group(
        t('skills.sectionSkills'),
        t('skills.emptySkills'),
        skills,
        value.skills,
        (slugs) => ({ ...value, skills: slugs }),
      ),
      group(
        t('skills.sectionConnectors'),
        t('skills.emptyConnectors'),
        connectors,
        value.connectors,
        (slugs) => ({ ...value, connectors: slugs }),
      ),
      ...toolGroups(),
    ];
  }, [skills, connectors, tools, value, onChange, t]);

  const count =
    value.skills.length + value.connectors.length + value.tools.length;
  const asField = label !== undefined || description !== undefined;

  const menu = (
    <DropdownMenu
      align={asField ? 'start' : align}
      disabled={disabled}
      trigger={
        <Button
          variant={variant}
          size={asField ? 'default' : 'sm'}
          aria-label={t('skills.label')}
          aria-haspopup="menu"
          className={
            asField
              ? 'w-full min-w-0 justify-between'
              : 'w-fit max-w-full min-w-0'
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <Blocks aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">
              {count > 0
                ? t('skills.labelWithCount', { count })
                : t('skills.label')}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={
              asField ? 'size-4 shrink-0 opacity-50' : 'size-3.5 shrink-0'
            }
          />
        </Button>
      }
      items={items}
    />
  );

  if (label === undefined && description === undefined) return menu;

  return (
    <FieldShell
      wideControl
      {...(label !== undefined
        ? { label: <Label id={labelId}>{label}</Label> }
        : {})}
      {...(description !== undefined
        ? {
            description: (
              <Description id={descriptionId}>{description}</Description>
            ),
          }
        : {})}
    >
      <div
        role="group"
        className={asField ? 'w-full' : 'w-fit max-w-full'}
        aria-labelledby={label !== undefined ? labelId : undefined}
        aria-describedby={description !== undefined ? descriptionId : undefined}
      >
        {menu}
      </div>
    </FieldShell>
  );
}
