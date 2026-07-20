'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useT } from '@/lib/i18n/client';

import { useListSkills } from '../hooks/queries';
import { toSkillRows } from '../lib/skill-rows';

export interface SkillBindingsMode {
  selected: string[];
  onChange: (slugs: string[]) => void;
  max: number;
}

interface SkillBindingsSelectProps {
  organizationId: string;
  /**
   * The agent-binding selection this control exists for: the same `MultiSelect`
   * chip picker used by Bound integrations / Bound automations
   * (`tool-selector.tsx`), wired to the supplied selection state. There is no
   * inline detail viewer here — the footer links to the Skills settings
   * catalog, which owns the full read-only/manage view for every skill.
   */
  bindingMode: SkillBindingsMode;
  /**
   * Replaces the default "nothing to bind" text when the (filtered) skill
   * list is empty. Used by the agent Skills tab to point users to the org
   * Skills settings instead of generic copy.
   */
  emptyStateOverride: { description: ReactNode };
  /** Slugs hidden from the picker (e.g. workflow disciplines on external agents). */
  excludeSlugs?: ReadonlySet<string>;
}

/**
 * Agent Skills-tab binding control. Unifies the skill picker with the
 * `MultiSelect` chip control already used for Bound integrations / Bound
 * automations (#2569) instead of the bespoke checkbox table it replaces —
 * one binding-picker language across the agent editor.
 */
export function SkillBindingsSelect({
  organizationId,
  bindingMode,
  emptyStateOverride,
  excludeSlugs,
}: SkillBindingsSelectProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const { skills: rawSkills, isLoading } = useListSkills(organizationId);
  const skills = useMemo(() => toSkillRows(rawSkills), [rawSkills]);
  const filteredSkills = useMemo(() => {
    if (!excludeSlugs || excludeSlugs.size === 0) return skills;
    return skills.filter((s) => !excludeSlugs.has(s.slug));
  }, [skills, excludeSlugs]);

  const selectedSet = useMemo(
    () => new Set(bindingMode.selected),
    [bindingMode.selected],
  );
  const atCap = bindingMode.selected.length >= bindingMode.max;

  // A load-error row (broken SKILL.md) can't be bound — surfaced disabled
  // with its failure summary as the description, so admins can still find
  // and fix it instead of it silently vanishing from the picker.
  const options = useMemo(
    () =>
      filteredSkills.map((skill) => {
        const hasError = Boolean(skill.status);
        const errorDescription = hasError
          ? t('skills.columns.loadError', {
              defaultValue: 'Failed to read SKILL.md',
            })
          : undefined;
        return {
          value: skill.slug,
          label: skill.name,
          description: hasError ? errorDescription : skill.description,
          disabled: hasError || (atCap && !selectedSet.has(skill.slug)),
        };
      }),
    [filteredSkills, atCap, selectedSet, t],
  );

  const isEmpty = !isLoading && filteredSkills.length === 0;

  return (
    <Stack gap={4}>
      <HStack justify="end" align="center" className="px-1" aria-live="polite">
        <Text variant="caption">
          {t('agents.form.skillBindingsCounter', {
            defaultValue: '{count}/{max} bound',
            count: bindingMode.selected.length,
            max: bindingMode.max,
          })}
        </Text>
      </HStack>
      {isEmpty ? (
        emptyStateOverride.description
      ) : (
        <Skeletonize
          loading={isLoading}
          label={t('agents.form.sectionSkillBindings')}
        >
          <MultiSelect
            value={bindingMode.selected}
            onValueChange={bindingMode.onChange}
            options={options}
            placeholder={t('agents.form.bindSkillsPlaceholder', {
              defaultValue: 'Bind skills…',
            })}
            searchPlaceholder={tCommon('search.placeholder')}
            emptyText={tCommon('search.noResults')}
            aria-label={t('agents.form.sectionSkillBindings')}
            footer={
              <Link
                to="/dashboard/$id/settings/skills"
                params={{ id: organizationId }}
                className="text-foreground hover:bg-muted flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium"
              >
                <ArrowUpRight className="size-4" aria-hidden="true" />
                {t('skills.manageInSettings', {
                  defaultValue: 'Manage in Skills settings',
                })}
              </Link>
            }
          />
        </Skeletonize>
      )}
    </Stack>
  );
}
