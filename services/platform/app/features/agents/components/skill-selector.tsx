'use client';

import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { useCallback, useMemo } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useListSkills } from '@/app/features/skills/hooks/queries';
import { useT } from '@/lib/i18n/client';

interface AvailableSkill {
  slug: string;
  name: string;
  description: string;
  toolNames?: string[];
  integrationBindings?: string[];
  workflowBindings?: string[];
  hash: string;
}

export interface SkillBindingResolvedEntry {
  slug: string;
  versionHash: string;
  toolNames: string[];
  integrationBindings: string[];
  workflowBindings: string[];
}

interface SkillSelectorProps {
  organizationId: string;
  /** Current bound slug list (camelCase, from agent JSON). */
  value: string[];
  /**
   * Called when the user toggles a binding. Receives BOTH the new slug list
   * and the matching resolved snapshot so the caller can persist them
   * together — the snapshot is required for the runtime trust boundary.
   */
  onChange: (bindings: string[], resolved: SkillBindingResolvedEntry[]) => void;
  disabled?: boolean;
}

export function SkillSelector({
  organizationId,
  value,
  onChange,
  disabled,
}: SkillSelectorProps) {
  const { t } = useT('settings');
  const { skills: rawSkills, isLoading } = useListSkills(organizationId);

  const skills = useMemo<AvailableSkill[]>(() => {
    if (!Array.isArray(rawSkills)) return [];
    const out: AvailableSkill[] = [];
    for (const s of rawSkills) {
      if (!s || typeof s.slug !== 'string') continue;
      if ('status' in s && typeof s.status === 'string') continue;
      if (typeof s.name !== 'string' || typeof s.description !== 'string') {
        continue;
      }
      out.push({
        slug: s.slug,
        name: s.name,
        description: s.description,
        toolNames: s.toolNames,
        integrationBindings: s.integrationBindings,
        workflowBindings: s.workflowBindings,
        hash: typeof s.hash === 'string' ? s.hash : '',
      });
    }
    return out;
  }, [rawSkills]);

  const skillBySlug = useMemo(() => {
    const m = new Map<string, AvailableSkill>();
    for (const s of skills) m.set(s.slug, s);
    return m;
  }, [skills]);

  const handleToggle = useCallback(
    (slug: string, checked: boolean) => {
      const set = new Set(value);
      if (checked) set.add(slug);
      else set.delete(slug);
      const nextBindings = Array.from(set);
      const resolved: SkillBindingResolvedEntry[] = [];
      for (const s of nextBindings) {
        const meta = skillBySlug.get(s);
        if (!meta) continue;
        resolved.push({
          slug: meta.slug,
          versionHash: meta.hash,
          toolNames: meta.toolNames ?? [],
          integrationBindings: meta.integrationBindings ?? [],
          workflowBindings: meta.workflowBindings ?? [],
        });
      }
      onChange(nextBindings, resolved);
    },
    [value, skillBySlug, onChange],
  );

  if (isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (skills.length === 0) {
    return (
      <Text variant="muted">
        {t('skills.selector.empty', {
          defaultValue:
            'No skills available in this organization yet. Create one under Skills.',
        })}
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      {skills.map((skill) => {
        const transitive =
          (skill.toolNames?.length ?? 0) +
          (skill.integrationBindings?.length ?? 0) +
          (skill.workflowBindings?.length ?? 0);
        const checked = value.includes(skill.slug);
        return (
          <Stack
            key={skill.slug}
            gap={1}
            className="border-border rounded-md border p-3"
          >
            <div className="flex items-center gap-2">
              <Checkbox
                id={`skill-${skill.slug}`}
                checked={checked}
                onCheckedChange={(state) =>
                  handleToggle(skill.slug, state === true)
                }
                disabled={disabled}
                label={skill.name}
              />
              {transitive > 0 ? (
                <Badge variant="outline">
                  {t('skills.selector.deps', {
                    defaultValue: '{count} deps',
                    count: transitive,
                  })}
                </Badge>
              ) : null}
            </div>
            <Text variant="muted" className="ml-7 line-clamp-2">
              {skill.description}
            </Text>
            {checked && transitive > 0 ? (
              <Text variant="caption" className="ml-7">
                {t('skills.selector.transitive', {
                  defaultValue:
                    'Binding enables: {tools}{integrations}{workflows}',
                  tools: skill.toolNames?.length
                    ? `tools(${skill.toolNames.join(', ')}) `
                    : '',
                  integrations: skill.integrationBindings?.length
                    ? `integrations(${skill.integrationBindings.join(', ')}) `
                    : '',
                  workflows: skill.workflowBindings?.length
                    ? `workflows(${skill.workflowBindings.join(', ')})`
                    : '',
                })}
              </Text>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}
