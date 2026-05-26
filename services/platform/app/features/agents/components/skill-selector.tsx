'use client';

import { Grid, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { useListSkills } from '@/app/features/skills/hooks/queries';
import { useT } from '@/lib/i18n/client';

const MAX_SKILL_BINDINGS = 10;

interface SkillSelectorProps {
  value: string[];
  onChange: (skills: string[]) => void;
  organizationId: string;
  disabled?: boolean;
}

interface AvailableSkill {
  slug: string;
  description?: string;
}

export function SkillSelector({
  value,
  onChange,
  organizationId,
  disabled,
}: SkillSelectorProps) {
  const { t } = useT('settings');
  const { skills, isLoading } = useListSkills(organizationId);

  const availableSkills = useMemo<AvailableSkill[]>(() => {
    if (!Array.isArray(skills)) return [];
    return skills
      .filter(
        (s: unknown): s is { slug: string; description?: string } =>
          typeof s === 'object' &&
          s !== null &&
          'slug' in s &&
          typeof (s as { slug: unknown }).slug === 'string',
      )
      .map((s) => ({ slug: s.slug, description: s.description }));
  }, [skills]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const atCap = value.length >= MAX_SKILL_BINDINGS;

  const toggle = (slug: string) => {
    if (selectedSet.has(slug)) {
      onChange(value.filter((s) => s !== slug));
    } else if (!atCap) {
      onChange([...value, slug]);
    }
  };

  return (
    <FormSection
      label={t('agents.form.sectionSkillBindings')}
      description={t('agents.form.sectionSkillBindingsDescription')}
    >
      <fieldset disabled={disabled}>
        {isLoading ? (
          <Skeleton className="h-6 w-full" />
        ) : availableSkills.length === 0 ? (
          <Text variant="caption" className="italic">
            {t('agents.form.noSkillsAvailable')}
          </Text>
        ) : (
          <Stack gap={2}>
            {value.length === 0 && (
              <Text variant="caption" className="italic">
                {t('agents.form.noSkillsBoundHint')}
              </Text>
            )}
            <Grid cols={2} className="gap-x-4 gap-y-1.5">
              {availableSkills.map((skill) => {
                const checked = selectedSet.has(skill.slug);
                return (
                  <Checkbox
                    key={skill.slug}
                    label={skill.slug}
                    checked={checked}
                    disabled={!checked && atCap}
                    onCheckedChange={() => toggle(skill.slug)}
                  />
                );
              })}
            </Grid>
          </Stack>
        )}
      </fieldset>
    </FormSection>
  );
}
