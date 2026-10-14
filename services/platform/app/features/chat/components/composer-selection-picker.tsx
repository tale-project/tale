'use client';

/**
 * The composer's ONE selection picker: which model answers, at which
 * reasoning effort, with which skills — a single trigger ("<model> <effort>
 * ▾") over a single menu.
 *
 * The skills are the conversation's: every reply in it reads the ones
 * checked before it answers (one message's own skills are typed as `/name`
 * in the field). There are no agent rows, no connector equipment and no
 * sandbox harnesses — those live on tasks and automations (the
 * Chat·Task·Automation boundary model). The menu is SECTION rows, each
 * opening a submenu whose list is searchable and scrolls after four rows, so
 * a hundred-model catalog never grows the menu past the viewport.
 */

import { Button } from '@tale/ui/button';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { BookOpen, ChevronDown, Cpu, Gauge } from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';

import type { ComposerSkillChoice } from '@/app/lib/backend/chat';
import { EFFORT_LEVELS, type ReasoningEffort } from '@/lib/chat/effort';
import { useT } from '@/lib/i18n/client';
import { CHOSEN_SKILLS_MAX } from '@/lib/skills/slash';

import type { ComposerModelOption, ComposerSelection } from '../types';
import { autoAvailable } from './composer-model-picker';
import {
  PickerSearchList,
  type PickerSearchOption,
} from './picker-search-list';

/** Explicit key map so the i18n usage check sees every catalog key. */
const LEVEL_LABEL_KEY: Record<ReasoningEffort, string> = {
  low: 'effort.low',
  medium: 'effort.medium',
  high: 'effort.high',
  extra: 'effort.extra',
  max: 'effort.max',
};

interface ComposerSelectionPickerProps {
  /** The direct-served models the chat lane can call. */
  models: readonly ComposerModelOption[];
  /** Providers whose models only a subscription serves: chat leaves them out
   * (a subscription runs only in its vendor's own runtime, in tasks and
   * automations), and the model list says so under its rows. */
  subscriptionProviders?: readonly string[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  /** The skills the person may choose; none hides the Skills section. */
  skills?: readonly ComposerSkillChoice[];
  disabled?: boolean;
}

export function ComposerSelectionPicker({
  models,
  subscriptionProviders = [],
  selection,
  onSelectionChange,
  skills = [],
  disabled,
}: ComposerSelectionPickerProps) {
  const { t } = useT('chat');
  const { locale } = useLocale();
  const subscriptionNote =
    subscriptionProviders.length > 0
      ? t('modelSelector.subscriptionsTasksOnly', {
          providers: new Intl.ListFormat(locale, {
            type: 'conjunction',
          }).format(subscriptionProviders),
        })
      : undefined;
  // Controlled so a single pick inside a section submenu can close the whole
  // menu the way a plain menu item would.
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  const autoSelected = selection.modelSelection === 'auto';
  const selectedModel =
    models.find(
      (model) =>
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
    ) ?? models.find((model) => model.id === selection.modelId);

  const effort = selection.reasoningEffort;
  const effortApplies = selectedModel?.reasoning !== undefined;
  /** The model's endpoint refuses tools+effort together — no levels are
   * offered, the hint says why, and a sticky pick reads as Default (the
   * resolver sends the catalog's off value regardless). */
  const effortLocked = selectedModel?.reasoning?.toolsRequireOff === true;

  /** Model rows — provider-qualified (the provider's display name, so an
   * org-defined provider reads by the name its admin gave it) so the same id
   * under two providers is distinguishable, and searchable by the model, the
   * provider's name or its slug. Auto leads the list when the
   * catalog offers a real choice; picking it clears the pinned model AND the
   * effort (the pick that paired with the old model must not silently steer
   * whatever Auto resolves). Picking a model drops the Auto mode likewise —
   * the two spellings are mutually exclusive all the way to the wire. */
  const modelChoices = useMemo<PickerSearchOption[]>(() => {
    const rows: PickerSearchOption[] = models.map((model) => ({
      key: `${model.providerSlug}:${model.id}`,
      search: `${model.label} ${model.providerSlug} ${model.providerLabel ?? ''}`,
      label: (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{model.label}</span>
          <span className="text-muted-foreground/70 shrink-0 text-xs">
            {model.providerLabel ?? model.providerSlug}
          </span>
        </span>
      ),
      selected:
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
      onSelect: () => {
        const { modelSelection: _auto, ...rest } = selection;
        onSelectionChange({
          ...rest,
          modelId: model.id,
          providerSlug: model.providerSlug,
        });
      },
    }));
    if (!autoAvailable(models)) return rows;
    return [
      {
        key: 'auto',
        search: `${t('modelSelector.auto')} auto`,
        // The description rides the row visually but stays out of the
        // accessible name (ariaLabel below keeps announcements short).
        label: (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{t('modelSelector.auto')}</span>
            <span className="text-muted-foreground/70 text-xs leading-snug text-wrap">
              {t('modelSelector.autoDescription')}
            </span>
          </span>
        ),
        ariaLabel: t('modelSelector.auto'),
        selected: autoSelected,
        onSelect: () => onSelectionChange({ modelSelection: 'auto' }),
      },
      ...rows,
    ];
  }, [models, selection, autoSelected, onSelectionChange, t]);

  /** The skills the conversation uses: a checkbox per skill the person may
   * use, beside any it still names that they no longer can — those read
   * unavailable and can only be unchecked. At most {@link CHOSEN_SKILLS_MAX}
   * are checked; the others wait until one is unchecked. */
  const chosenSkills = useMemo(
    () => selection.skills ?? [],
    [selection.skills],
  );
  const skillChoices = useMemo<PickerSearchOption[]>(() => {
    const full = chosenSkills.length >= CHOSEN_SKILLS_MAX;
    const toggle = (slug: string) => {
      const next = chosenSkills.includes(slug)
        ? chosenSkills.filter((name) => name !== slug)
        : [...chosenSkills, slug];
      onSelectionChange({ ...selection, skills: next });
    };
    const available = new Set(skills.map((skill) => skill.slug));
    return [
      ...skills.map((skill): PickerSearchOption => ({
        key: skill.slug,
        search: `${skill.slug} ${skill.description ?? ''}`,
        label: (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{skill.slug}</span>
            {skill.description !== undefined && (
              <span className="text-muted-foreground/70 line-clamp-2 text-xs leading-snug text-wrap">
                {skill.description}
              </span>
            )}
          </span>
        ),
        ariaLabel: skill.slug,
        selected: chosenSkills.includes(skill.slug),
        disabled: full && !chosenSkills.includes(skill.slug),
        onSelect: () => toggle(skill.slug),
      })),
      ...chosenSkills
        .filter((slug) => !available.has(slug))
        .map((slug): PickerSearchOption => ({
          key: slug,
          label: t('skills.unavailableOption', { slug }),
          selected: true,
          onSelect: () => toggle(slug),
        })),
    ];
  }, [skills, chosenSkills, selection, onSelectionChange, t]);

  const items = useMemo<DropdownMenuGroup[]>(() => {
    /** One section: a submenu row whose panel is a searchable list. */
    const section = (
      label: string,
      icon: ComponentType<{ className?: string }>,
      trailing: string | undefined,
      content: DropdownMenuItem,
    ): DropdownMenuItem => ({
      type: 'sub',
      label,
      icon,
      ...(trailing !== undefined ? { trailing } : {}),
      contentClassName: 'min-w-60',
      items: [[content]],
    });

    const groups: DropdownMenuGroup[] = [
      [
        section(
          t('picker.sectionModel'),
          Cpu,
          autoSelected ? t('modelSelector.auto') : selectedModel?.label,
          {
            type: 'custom',
            content: (
              <div className="flex min-w-0 flex-col">
                <PickerSearchList
                  options={modelChoices}
                  emptyHint={t('modelSelector.noModelsAvailable')}
                  onPicked={closeMenu}
                />
                {subscriptionNote !== undefined && (
                  <p className="text-muted-foreground max-w-56 px-2 pt-1.5 pb-1 text-xs leading-snug">
                    {subscriptionNote}
                  </p>
                )}
              </div>
            ),
          },
        ),
      ],
    ];

    if (effortApplies) {
      const levels: ReadonlyArray<ReasoningEffort | undefined> = effortLocked
        ? [undefined]
        : [undefined, ...EFFORT_LEVELS];
      groups.push([
        section(
          t('effort.label'),
          Gauge,
          effortLocked || effort === undefined
            ? t('effort.default')
            : t(LEVEL_LABEL_KEY[effort]),
          {
            type: 'custom',
            content: (
              <div className="flex min-w-0 flex-col">
                <p className="text-muted-foreground max-w-56 px-2 pt-1 pb-1.5 text-xs leading-snug">
                  {t(
                    effortLocked
                      ? 'effort.toolsLockedHint'
                      : 'effort.description',
                  )}
                </p>
                <PickerSearchList
                  options={levels.map((level) => ({
                    key: level ?? 'default',
                    search:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    label:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    selected: effortLocked
                      ? level === undefined
                      : effort === level,
                    onSelect: () =>
                      onSelectionChange({
                        ...selection,
                        reasoningEffort: level,
                      }),
                  }))}
                  emptyHint={t('effort.default')}
                  onPicked={closeMenu}
                />
                {!effortLocked && (
                  <p className="text-muted-foreground max-w-56 px-2 pt-1.5 pb-1 text-xs leading-snug">
                    {t('effort.maxHint')}
                  </p>
                )}
              </div>
            ),
          },
        ),
      ]);
    }

    if (skillChoices.length > 0) {
      groups.push([
        section(
          t('picker.sectionSkills'),
          BookOpen,
          chosenSkills.length > 0
            ? t('picker.skillsChosen', { count: chosenSkills.length })
            : undefined,
          {
            type: 'custom',
            content: (
              <div className="flex min-w-0 flex-col">
                <p className="text-muted-foreground max-w-64 px-2 pt-1 pb-1.5 text-xs leading-snug">
                  {t('picker.skillsDescription')}
                </p>
                <PickerSearchList
                  options={skillChoices}
                  emptyHint={t('skills.emptySkills')}
                  multiSelect
                />
                <p className="text-muted-foreground max-w-64 px-2 pt-1.5 pb-1 text-xs leading-snug">
                  {t('picker.skillsLimit', { max: CHOSEN_SKILLS_MAX })}
                </p>
              </div>
            ),
          },
        ),
      ]);
    }

    return groups;
  }, [
    modelChoices,
    subscriptionNote,
    selection,
    onSelectionChange,
    selectedModel,
    autoSelected,
    effort,
    effortApplies,
    effortLocked,
    skillChoices,
    chosenSkills,
    t,
  ]);

  // The trigger reads like Claude's: the model (or Auto), with the effort as
  // a muted suffix when one is picked.
  const triggerLabel = autoSelected
    ? t('modelSelector.auto')
    : (selectedModel?.label ??
      (models.length > 0
        ? t('modelSelector.label')
        : t('modelSelector.noModelsAvailable')));
  const triggerSuffix =
    effortApplies && !effortLocked && effort !== undefined
      ? t(LEVEL_LABEL_KEY[effort])
      : undefined;

  return (
    <DropdownMenu
      align="start"
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            chosenSkills.length > 0
              ? `${t('picker.ariaLabel')}, ${t('picker.skillsChosen', { count: chosenSkills.length })}`
              : t('picker.ariaLabel')
          }
          aria-haspopup="menu"
          className="max-w-64 min-w-0 gap-1"
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {triggerSuffix !== undefined && (
            <span className="text-muted-foreground shrink-0">
              {` ${triggerSuffix}`}
            </span>
          )}
          {chosenSkills.length > 0 && (
            // How many skills the conversation reads, at a glance; the
            // Skills section names them.
            <span
              aria-hidden
              className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5"
            >
              <BookOpen className="size-3" />
              {chosenSkills.length}
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
