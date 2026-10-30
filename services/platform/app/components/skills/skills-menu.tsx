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
 * reads as a bug, not as "nothing to equip". A catalog that has not answered
 * is not an empty one: while it loads, or after its read failed (`catalog`),
 * the skills and connectors groups say that instead. The menu only
 * ASSEMBLES; what a selection does is decided by the lane that runs the
 * agent.
 */

import type { SkillOrigin } from '@tale/shared/schemas/skills';
import { Button } from '@tale/ui/button';
import { Description } from '@tale/ui/description';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { FieldShell } from '@tale/ui/field-shell';
import { Label } from '@tale/ui/label';
import { Blocks, ChevronDown } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { useSkillAttribution } from './use-skill-attribution';

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
  /** A skill's provenance: when set, the row's caption names who created it
   * (`useSkillAttribution`) — what an editor weighs before equipping it. */
  readonly origin?: SkillOrigin;
  readonly ownerName?: string;
}

/** The assembled equipment: org skill slugs + enabled-connector slugs +
 * granted platform-tool names. */
export interface SkillsSelection {
  readonly skills: readonly string[];
  readonly connectors: readonly string[];
  readonly tools: readonly string[];
}

/** Whether the skills and connectors on offer are the catalog's answer, the
 * catalog is still loading, or its read failed with nothing to show. */
export type SkillsCatalogState = 'loaded' | 'loading' | 'unavailable';

interface SkillsMenuProps {
  skills: readonly SkillOption[];
  connectors: readonly SkillOption[];
  /**
   * Defaults to `'loaded'`. Until the catalog has answered, and after its
   * read failed, the skills and connectors on offer are unknown, not empty:
   * both groups say which instead of `emptySkills` / `emptyConnectors`, and
   * no equipped slug is listed as unavailable on a list that has not
   * arrived. The selection is kept and still counts; tools stay choosable.
   */
  catalog?: SkillsCatalogState;
  /** Grantable platform tools (task/document reads and writes). */
  tools: readonly SkillOption[];
  /**
   * Capabilities every agent has without a grant — knowledge search on the
   * managed lanes. Listed checked and locked in their `group`, ahead of the
   * grantable tools there, so the menu shows the whole equipment, not just
   * what can be toggled. Never part of `value`.
   */
  lockedTools?: readonly SkillOption[];
  value: SkillsSelection;
  onChange: (next: SkillsSelection) => void;
  disabled?: boolean;
  /** Trigger styling per host surface (composer sits in a ghost toolbar). */
  variant?: 'ghost' | 'secondary';
  align?: 'start' | 'end';
  /** Field label — same Label chrome as Input/Select. Omit only for unlabeled toolbars. */
  label?: string;
  description?: ReactNode;
  /** Set when the menu is opened from inside a modal Dialog. */
  modal?: boolean;
}

/** Stable empty default, so the memoised groups do not rebuild per render. */
const NO_LOCKED_TOOLS: readonly SkillOption[] = [];

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
  catalog = 'loaded',
  tools,
  lockedTools = NO_LOCKED_TOOLS,
  value,
  onChange,
  disabled,
  variant = 'secondary',
  align = 'end',
  label,
  description,
  modal,
}: SkillsMenuProps) {
  // The capability vocabulary lives in the chat namespace; every surface
  // shares it so the labels can never diverge between hosts.
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { creatorHint } = useSkillAttribution();
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
      ...(option.origin !== undefined
        ? {
            description: creatorHint({
              origin: option.origin,
              ...(option.ownerName !== undefined
                ? { ownerName: option.ownerName }
                : {}),
            }),
          }
        : option.description !== undefined
          ? { description: option.description }
          : {}),
      checked: selected.includes(option.slug),
      onCheckedChange: (next: boolean) =>
        onChange(apply(toggle(selected, option.slug, next))),
    });

    // A disabled row saying why a group offers nothing to tick.
    const note = (text: string) => ({
      type: 'item' as const,
      label: text,
      disabled: true,
      onClick: () => undefined,
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
        ? [note(empty)]
        : options.map((option) => checkbox(option, selected, apply))),
    ];

    // An always-on capability: checked, not switchable, its description
    // saying why.
    const locked = (option: SkillOption) => ({
      type: 'checkbox' as const,
      label: option.label,
      ...(option.description !== undefined
        ? { description: option.description }
        : {}),
      checked: true,
      locked: true,
      onCheckedChange: () => undefined,
    });

    // The tools section, sub-grouped by each option's `group` (its module):
    // one label per distinct module, in first-seen order, so the picker reads
    // as Tasks / Documents / Knowledge / … instead of one flat list. Tools
    // with no `group` fall under the generic section label. Locked tools lead
    // their group.
    const toolGroups = (): DropdownMenuGroup[] => {
      if (tools.length === 0 && lockedTools.length === 0) {
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
      const byGroup = new Map<
        string,
        { locked: SkillOption[]; grantable: SkillOption[] }
      >();
      const slot = (option: SkillOption) => {
        const key = option.group ?? t('skills.sectionTools');
        let entry = byGroup.get(key);
        if (entry === undefined) {
          entry = { locked: [], grantable: [] };
          byGroup.set(key, entry);
          order.push(key);
        }
        return entry;
      };
      for (const option of tools) slot(option).grantable.push(option);
      for (const option of lockedTools) slot(option).locked.push(option);
      return order.map((key): DropdownMenuGroup => {
        const entry = byGroup.get(key) ?? { locked: [], grantable: [] };
        const header: DropdownMenuGroup = [{ type: 'label', content: key }];
        return header.concat(
          entry.locked.map(locked),
          entry.grantable.map((option) => checkbox(option, value.tools, apply)),
        );
      });
    };

    // No catalog answer yet, or none at all: what is on offer is unknown,
    // so each group says why it lists nothing rather than claiming the
    // organization has none, and no equipped slug is called unavailable.
    if (catalog !== 'loaded') {
      const unknown = (section: string, unavailable: string) => [
        { type: 'label' as const, content: section },
        note(catalog === 'loading' ? tCommon('actions.loading') : unavailable),
      ];
      return [
        unknown(t('skills.sectionSkills'), t('skills.skillsUnavailable')),
        unknown(
          t('skills.sectionConnectors'),
          t('skills.connectorsUnavailable'),
        ),
        ...toolGroups(),
      ];
    }

    // An equipped skill the picker cannot see any more — one that was
    // unshared from this scope after it was equipped — still counts and
    // still fails a run, so it is listed as a checked, removable entry
    // rather than hidden behind a count nothing in the menu explains.
    const unavailableSkills: SkillOption[] = value.skills
      .filter((slug) => !skills.some((option) => option.slug === slug))
      .map((slug) => ({
        slug,
        label: t('skills.unavailableOption', { slug }),
      }));
    const unavailableConnectors: SkillOption[] = value.connectors
      .filter((slug) => !connectors.some((option) => option.slug === slug))
      .map((slug) => ({
        slug,
        label: t('skills.unavailableOption', { slug }),
      }));

    return [
      group(
        t('skills.sectionSkills'),
        t('skills.emptySkills'),
        [...skills, ...unavailableSkills],
        value.skills,
        (slugs) => ({ ...value, skills: slugs }),
      ),
      group(
        t('skills.sectionConnectors'),
        t('skills.emptyConnectors'),
        [...connectors, ...unavailableConnectors],
        value.connectors,
        (slugs) => ({ ...value, connectors: slugs }),
      ),
      ...toolGroups(),
    ];
  }, [
    skills,
    connectors,
    catalog,
    tools,
    lockedTools,
    value,
    onChange,
    t,
    tCommon,
    creatorHint,
  ]);

  const count =
    value.skills.length + value.connectors.length + value.tools.length;
  const asField = label !== undefined || description !== undefined;

  const menu = (
    <DropdownMenu
      align={asField ? 'start' : align}
      disabled={disabled}
      modal={modal}
      search={{
        label: t('skills.searchLabel'),
        placeholder: t('skills.searchPlaceholder'),
        emptyText: t('skills.searchEmpty'),
      }}
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
