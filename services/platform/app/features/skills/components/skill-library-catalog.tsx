'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { FileUp, FolderUp, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CatalogGridSkeleton } from '@/app/components/catalog/catalog-card-skeleton';
import {
  CatalogCard,
  CatalogCardIcon,
  CatalogGrid,
} from '@/app/components/catalog/catalog-grid';
import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { useCatalogSearch } from '@/app/components/catalog/use-catalog-search';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useT } from '@/lib/i18n/client';
import type { SkillUsageMode } from '@/lib/shared/schemas/skills';

import { useSkills } from '../hooks/queries';
import {
  collectLabelFacets,
  matchesLabelFilter,
  matchesScopeTab,
  SKILL_SCOPE_TABS,
  type SkillScopeTab,
} from '../lib/skill-filters';
import {
  resolveSkillLoadErrorPresentation,
  skillLoadErrorDetailTitleKey,
} from '../utils/skill-load-error';

interface SkillSummary {
  slug: string;
  description: string;
  visibility: 'private' | 'team' | 'org';
  teams?: string[];
  usageMode?: SkillUsageMode;
  icon?: string;
  labels?: string[];
  canEdit: boolean;
}

const skillHaystack = (skill: SkillSummary) => [
  skill.slug,
  skill.description,
  ...(skill.labels ?? []),
];

export type SkillAddChoice =
  | { kind: 'blank' }
  | { kind: 'upload'; mode: 'zip' | 'folder' };

/**
 * The library's list pane: every skill the member may see as catalog cards,
 * with scope tabs (all / org / teams / personal), search, a label facet,
 * and the add menu (blank skill, zip upload, folder upload). Unreadable
 * bundles surface as an operator banner instead of vanishing.
 */
export function SkillLibraryCatalog({
  organizationId,
  onOpen,
  onAdd,
}: {
  organizationId: string;
  onOpen: (slug: string) => void;
  onAdd: (choice: SkillAddChoice) => void;
}) {
  const { t } = useT('skills');
  const { t: tEmpty } = useT('emptyStates');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SkillScopeTab>('all');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);

  const skillsQuery = useSkills(organizationId);
  const skills: SkillSummary[] = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );
  const failures = skillsQuery.data?.failures ?? [];
  const { teams } = useOrgTeams();
  const teamNames = useMemo(
    () => new Map((teams ?? []).map((team) => [team.id, team.name])),
    [teams],
  );

  const scoped = useMemo(
    () =>
      skills.filter(
        (skill) =>
          matchesScopeTab(skill, tab) &&
          matchesLabelFilter(skill, selectedLabels),
      ),
    [skills, tab, selectedLabels],
  );
  const filtered = useCatalogSearch(scoped, query, skillHaystack);
  const labelFacets = useMemo(() => collectLabelFacets(skills), [skills]);

  const addMenuGroups: DropdownMenuGroup[] = [
    [
      {
        type: 'item',
        label: t('createMenu.blank'),
        icon: Plus,
        onClick: () => onAdd({ kind: 'blank' }),
      },
      {
        type: 'item',
        label: t('createMenu.uploadZip'),
        icon: FileUp,
        onClick: () => onAdd({ kind: 'upload', mode: 'zip' }),
      },
      {
        type: 'item',
        label: t('createMenu.uploadFolder'),
        icon: FolderUp,
        onClick: () => onAdd({ kind: 'upload', mode: 'folder' }),
      },
    ],
  ];

  const visibilityBadge = (skill: SkillSummary) => {
    if (skill.visibility === 'private') {
      return <Badge variant="outline">{t('visibility.private')}</Badge>;
    }
    if (skill.visibility === 'team') {
      const names = (skill.teams ?? []).map(
        (teamId) => teamNames.get(teamId) ?? t('visibility.unknownTeam'),
      );
      const label =
        names.length <= 1
          ? (names[0] ?? t('visibility.team'))
          : t('visibility.teamBadgeMore', {
              team: names[0],
              count: names.length - 1,
            });
      return <Badge variant="outline">{label}</Badge>;
    }
    return undefined;
  };

  const usageBadge = (skill: SkillSummary) => {
    const mode = skill.usageMode ?? 'all';
    if (mode === 'all') return null;
    return (
      <Badge variant="slate">
        {mode === 'chat' ? t('usage.chatBadge') : t('usage.agentBadge')}
      </Badge>
    );
  };

  return (
    <Stack gap={4} className="h-full min-h-0">
      <CatalogToolbar
        tabs={{
          items: SKILL_SCOPE_TABS.map((value) => ({
            value,
            label: t(`library.tabs.${value}`),
          })),
          value: tab,
          onValueChange: (value) => {
            const next = SKILL_SCOPE_TABS.find(
              (candidate) => candidate === value,
            );
            if (next !== undefined) setTab(next);
          },
        }}
        search={{
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: t('searchPlaceholder'),
        }}
        action={
          <div className="flex items-center gap-2">
            {labelFacets.length > 0 && (
              <div className="w-44">
                <MultiSelect
                  options={labelFacets.map((label) => ({
                    value: label,
                    label,
                  }))}
                  value={selectedLabels}
                  onValueChange={setSelectedLabels}
                  placeholder={t('library.labelFilterLabel')}
                  aria-label={t('library.labelFilterLabel')}
                />
              </div>
            )}
            <DropdownMenu
              items={addMenuGroups}
              trigger={
                <Button>
                  <Plus className="mr-1 size-4" />
                  {t('addMenu.label')}
                </Button>
              }
            />
          </div>
        }
      />

      {skillsQuery.isError && (
        <Alert variant="destructive" description={t('listFailed')} />
      )}
      {failures.length > 0 && (
        <Alert
          variant="destructive"
          title={t('columns.loadError')}
          description={
            <ul className="list-inside list-disc">
              {failures.map((failure) => {
                const presentation = resolveSkillLoadErrorPresentation(
                  undefined,
                  failure.message,
                );
                return (
                  <li key={failure.path}>
                    {t(skillLoadErrorDetailTitleKey(presentation))}
                    {' — '}
                    <code>{failure.path}</code>
                  </li>
                );
              })}
            </ul>
          }
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-2">
        {skillsQuery.isPending ? (
          <Skeletonize loading>
            <CatalogGridSkeleton />
          </Skeletonize>
        ) : filtered.length === 0 ? (
          <Stack gap={2} align="center" className="py-12 text-center">
            <Text as="p" className="font-medium">
              {skills.length === 0
                ? tEmpty('skills.title')
                : t('noResults.title')}
            </Text>
            <Text as="p" variant="muted" className="max-w-md">
              {skills.length === 0
                ? tEmpty('skills.description')
                : t('noResults.description')}
            </Text>
            {skills.length === 0 && (
              <Button
                variant="secondary"
                onClick={() => onAdd({ kind: 'blank' })}
              >
                {t('addMenu.label')}
              </Button>
            )}
          </Stack>
        ) : (
          <CatalogGrid>
            {filtered.map((skill) => (
              <CatalogCard
                key={skill.slug}
                media={
                  <CatalogCardIcon>
                    <SkillIcon icon={skill.icon} className="size-6" />
                  </CatalogCardIcon>
                }
                title={skill.slug}
                badge={
                  <span className="flex items-center gap-1">
                    {visibilityBadge(skill)}
                    {usageBadge(skill)}
                  </span>
                }
                meta={<CatalogLabels labels={skill.labels} tone="quiet" />}
                description={skill.description}
                onClick={() => onOpen(skill.slug)}
                ariaLabel={t('openSkill', { slug: skill.slug })}
              />
            ))}
          </CatalogGrid>
        )}
      </div>
    </Stack>
  );
}
