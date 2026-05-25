'use client';

import { Badge } from '@tale/ui/badge';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeleton } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useListSkills } from '@/app/features/skills/hooks/queries';
import { useT } from '@/lib/i18n/client';
import type { SkillBindingResolvedEntry } from '@/lib/shared/schemas/agents';

interface AvailableSkill {
  slug: string;
  name: string;
  description: string;
  toolNames?: string[];
  integrationBindings?: string[];
  workflowBindings?: string[];
  hash: string;
}

export type { SkillBindingResolvedEntry } from '@/lib/shared/schemas/agents';

interface SkillSelectorProps {
  organizationId: string;
  /** Current bound slug list (camelCase, from agent JSON). */
  value: string[];
  /**
   * The frozen `skillBindingsResolved` snapshot persisted on the agent.
   * Used solely to surface drift — the per-slug `versionHash` here is
   * compared against the live skill's hash so the operator sees when a
   * binding's capability surface has changed since they last saved.
   */
  resolvedSnapshot?: SkillBindingResolvedEntry[];
  /**
   * Called when the user toggles a binding. Receives BOTH the new slug list
   * and the matching resolved snapshot so the caller can persist them
   * together — the snapshot is required for the runtime trust boundary.
   */
  onChange: (bindings: string[], resolved: SkillBindingResolvedEntry[]) => void;
  disabled?: boolean;
}

function buildResolved(
  slugs: string[],
  skillBySlug: Map<string, AvailableSkill>,
): SkillBindingResolvedEntry[] {
  const out: SkillBindingResolvedEntry[] = [];
  for (const slug of slugs) {
    const meta = skillBySlug.get(slug);
    if (!meta) continue;
    out.push({
      slug: meta.slug,
      versionHash: meta.hash,
      toolNames: meta.toolNames ?? [],
      integrationBindings: meta.integrationBindings ?? [],
      workflowBindings: meta.workflowBindings ?? [],
    });
  }
  return out;
}

export function SkillSelector({
  organizationId,
  value,
  resolvedSnapshot,
  onChange,
  disabled,
}: SkillSelectorProps) {
  const { t } = useT('settings');
  const { skills: rawSkills, isLoading } = useListSkills(organizationId);
  const snapshotBySlug = useMemo(() => {
    const m = new Map<string, SkillBindingResolvedEntry>();
    for (const e of resolvedSnapshot ?? []) m.set(e.slug, e);
    return m;
  }, [resolvedSnapshot]);

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

  // When the live skill list refetches and any currently-bound skill's
  // hash has drifted from the snapshot we previously persisted, eagerly
  // push a fresh resolved snapshot up to the parent. Without this, the
  // drift badge said "re-save to refresh" but a pure Save click would
  // commit the *stale* snapshot — handleToggle was the only path that
  // rebuilt from live state. Now `value` + live `skillBySlug` always
  // converge on the next Save, regardless of whether the user toggled
  // anything in this session.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (skills.length === 0) return;
    let drift = false;
    for (const slug of value) {
      const live = skillBySlug.get(slug);
      const snap = snapshotBySlug.get(slug);
      if (!live) continue;
      if (!snap || snap.versionHash !== live.hash) {
        drift = true;
        break;
      }
    }
    if (!drift) return;
    onChangeRef.current(value, buildResolved(value, skillBySlug));
    // skills change drives this; we intentionally don't depend on
    // `value` so user toggles in the same render don't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills]);

  const handleToggle = useCallback(
    (slug: string, checked: boolean) => {
      const set = new Set(value);
      if (checked) set.add(slug);
      else set.delete(slug);
      const nextBindings = Array.from(set);
      onChange(nextBindings, buildResolved(nextBindings, skillBySlug));
    },
    [value, skillBySlug, onChange],
  );

  if (isLoading) {
    return (
      <Stack gap={3}>
        {Array.from({ length: 4 }).map((_, idx) => (
          <Stack
            key={idx}
            gap={2}
            className="border-border rounded-md border p-3"
          >
            <HStack gap={2} align="center">
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <Skeleton className="h-4 w-40" />
              <div className="flex-1" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </HStack>
            <Skeleton className="ml-7 h-3 w-3/4" />
          </Stack>
        ))}
      </Stack>
    );
  }

  if (skills.length === 0) {
    return (
      <Text variant="muted">
        {t('skills.selector.empty', {
          defaultValue:
            'No skills available in this organization yet. Create one under ',
        })}
        <Link
          to="/dashboard/$id/settings/skills"
          params={{ id: organizationId }}
          className="underline"
        >
          {t('skills.title', { defaultValue: 'Skills' })}
        </Link>
        .
      </Text>
    );
  }

  return (
    <Stack gap={3}>
      {skills.map((skill) => {
        const toolCount = skill.toolNames?.length ?? 0;
        const integrationCount = skill.integrationBindings?.length ?? 0;
        const workflowCount = skill.workflowBindings?.length ?? 0;
        const transitive = toolCount + integrationCount + workflowCount;
        const checked = value.includes(skill.slug);
        const snapshotEntry = snapshotBySlug.get(skill.slug);
        const driftDetected =
          checked &&
          snapshotEntry !== undefined &&
          skill.hash !== '' &&
          snapshotEntry.versionHash !== skill.hash;
        return (
          <Stack
            key={skill.slug}
            gap={1}
            className="border-border rounded-md border p-3"
          >
            <HStack gap={2} align="center">
              <Checkbox
                id={`skill-${skill.slug}`}
                checked={checked}
                onCheckedChange={(state) =>
                  handleToggle(skill.slug, state === true)
                }
                disabled={disabled}
                label={skill.name}
                description={skill.description}
              />
              {transitive > 0 ? (
                <Badge variant="outline">
                  {t('skills.selector.deps', {
                    defaultValue: '{count} deps',
                    count: transitive,
                  })}
                </Badge>
              ) : null}
              {driftDetected ? (
                <Badge
                  variant="destructive"
                  title={t('skills.selector.driftTooltip', {
                    defaultValue:
                      "This skill's capability surface changed since you bound it. Save to refresh the snapshot.",
                  })}
                >
                  {t('skills.selector.driftBadge', {
                    defaultValue: 'Drift — re-save to refresh',
                  })}
                </Badge>
              ) : null}
              <div className="flex-1" />
              <Link
                to="/dashboard/$id/settings/skills/$skillSlug"
                params={{ id: organizationId, skillSlug: skill.slug }}
                target="_blank"
                rel="noreferrer"
                aria-label={t('skills.selector.openDetail', {
                  defaultValue: 'Open {slug} in a new tab',
                  slug: skill.slug,
                })}
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-4" />
              </Link>
            </HStack>
            {checked && transitive > 0 ? (
              <Stack gap={0} className="ml-7">
                {toolCount > 0 ? (
                  <Text variant="caption">
                    {t('skills.selector.transitiveTools', {
                      defaultValue: 'Tools: {items}',
                      items: skill.toolNames!.join(', '),
                    })}
                  </Text>
                ) : null}
                {integrationCount > 0 ? (
                  <Text variant="caption">
                    {t('skills.selector.transitiveIntegrations', {
                      defaultValue: 'Integrations: {items}',
                      items: skill.integrationBindings!.join(', '),
                    })}
                  </Text>
                ) : null}
                {workflowCount > 0 ? (
                  <Text variant="caption">
                    {t('skills.selector.transitiveWorkflows', {
                      defaultValue: 'Workflows: {items}',
                      items: skill.workflowBindings!.join(', '),
                    })}
                  </Text>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}
