'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';
import type { ColumnDef } from '@tanstack/react-table';
import { Blocks, FileUp, FolderUp, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { ConfigIcon as SkillIcon } from '@/app/components/catalog/config-icon';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import type { FilterConfig } from '@/app/components/ui/data-table/data-table-filters';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useOrgTeams } from '@/app/features/settings/teams/hooks/queries';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';
import type { SkillUsageMode } from '@/lib/shared/schemas/skills';

import { useSkills } from '../hooks/queries';
import { SKILL_SCOPE_TABS, type SkillScopeTab } from '../lib/skill-filters';
import {
  resolveSkillLoadErrorPresentation,
  skillLoadErrorDetailTitleKey,
} from '../utils/skill-load-error';
import { SkillPaneDialog, type SkillPane } from './skill-pane-dialog';

const PAGE_SIZE = 25;

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

/** A skill row, with the facet values flattened for search and filtering. */
interface SkillRow extends SkillSummary {
  /** Space-joined labels, so the managed search covers them as a field. */
  labelText: string;
}

/**
 * The skills settings page: every skill the member may see, as a table.
 *
 * A table with no catalog behind its Add button, unlike the credential
 * surfaces. There is nothing to pick from — a skill is written or uploaded, not
 * chosen from a shipped list. (The builtin skills an organization starts with
 * are copied onto its config directory at scaffold time and are ordinary rows
 * here from that moment on.)
 *
 * Scope is a filter facet rather than a tab strip: the table owns its own
 * header, and visibility is one narrowing among several rather than a mode.
 * Unreadable bundles surface as an operator banner instead of vanishing.
 */
export function SkillsSettings({ organizationId }: { organizationId: string }) {
  const { t } = useT('skills');
  const { t: tNav } = useT('navigation');
  const { t: tEmpty } = useT('emptyStates');
  const [pane, setPane] = useState<SkillPane | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);

  const skillsQuery = useSkills(organizationId);
  const failures = skillsQuery.data?.failures ?? [];
  const { teams } = useOrgTeams();
  const teamNames = useMemo(
    () => new Map((teams ?? []).map((team) => [team.id, team.name])),
    [teams],
  );

  const skills: SkillSummary[] = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );

  const labelFacets = useMemo(() => {
    const seen = new Set<string>();
    for (const skill of skills)
      for (const label of skill.labels ?? []) seen.add(label);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [skills]);

  const rows = useMemo<SkillRow[]>(() => {
    const matching: SkillRow[] = [];
    for (const skill of skills) {
      if (scopes.length > 0) {
        const scope: SkillScopeTab =
          skill.visibility === 'org'
            ? 'org'
            : skill.visibility === 'team'
              ? 'team'
              : 'personal';
        if (!scopes.includes(scope)) continue;
      }
      // AND across facets, matching every other narrowing surface: a skill has
      // to carry EVERY selected label, not merely one of them.
      const labels = skill.labels ?? [];
      if (!labelFilter.every((label) => labels.includes(label))) continue;
      matching.push({ ...skill, labelText: labels.join(' ') });
    }
    return matching;
  }, [labelFilter, scopes, skills]);

  const filters: FilterConfig[] = [
    {
      key: 'scope',
      title: t('library.scopeFilterLabel'),
      options: SKILL_SCOPE_TABS.filter((scope) => scope !== 'all').map(
        (scope) => ({ value: scope, label: t(`library.tabs.${scope}`) }),
      ),
      selectedValues: scopes,
      onChange: setScopes,
      multiSelect: true,
    },
    ...(labelFacets.length > 0
      ? [
          {
            key: 'labels',
            title: t('library.labelFilterLabel'),
            options: labelFacets.map((label) => ({
              value: label,
              label,
            })),
            selectedValues: labelFilter,
            onChange: setLabelFilter,
            multiSelect: true,
          },
        ]
      : []),
  ];

  const columns = useMemo<ColumnDef<SkillRow>[]>(
    () => [
      {
        id: 'slug',
        accessorKey: 'slug',
        header: t('columns.name'),
        cell: ({ row }) => (
          <HStack align="center" gap={2} className="min-w-0">
            <SkillIcon icon={row.original.icon} className="size-4 shrink-0" />
            <span className="text-foreground truncate text-sm font-medium">
              {row.original.slug}
            </span>
          </HStack>
        ),
      },
      {
        id: 'description',
        accessorKey: 'description',
        header: t('columns.description'),
        size: 380,
        cell: ({ row }) => (
          <span className="text-muted-foreground line-clamp-2 text-sm">
            {row.original.description}
          </span>
        ),
      },
      {
        id: 'visibility',
        header: t('columns.visibility'),
        size: 160,
        cell: ({ row }) => {
          const skill = row.original;
          if (skill.visibility === 'org') {
            return <Badge variant="outline">{t('visibility.org')}</Badge>;
          }
          if (skill.visibility === 'private') {
            return <Badge variant="outline">{t('visibility.private')}</Badge>;
          }
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
        },
      },
      {
        id: 'usage',
        header: t('columns.usage'),
        size: 120,
        cell: ({ row }) => {
          const mode = row.original.usageMode ?? 'all';
          // "Everywhere" is the default and needs no marker; the column reads
          // as the exceptions it lists.
          if (mode === 'all') return null;
          return (
            <Badge variant="slate">
              {mode === 'chat' ? t('usage.chatBadge') : t('usage.agentBadge')}
            </Badge>
          );
        },
      },
      {
        id: 'labels',
        header: t('columns.labels'),
        size: 200,
        cell: ({ row }) => (
          <CatalogLabels labels={row.original.labels} tone="quiet" />
        ),
      },
    ],
    [t, teamNames],
  );

  const list = useListPage<SkillRow>({
    dataSource: {
      type: 'query',
      data: skillsQuery.isPending ? undefined : rows,
    },
    pageSize: PAGE_SIZE,
    search: {
      fields: ['slug', 'description', 'labelText'],
      placeholder: t('searchPlaceholder'),
    },
    filters: {
      configs: filters,
      onClear: () => {
        setScopes([]);
        setLabelFilter([]);
      },
    },
    getRowId: (row) => row.slug,
    entityLabel: { one: t('entityLabelOne'), other: t('entityLabel') },
  });

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('skills')}
        description={t('sectionDescription')}
      >
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

        <DataTable
          columns={columns}
          emptyState={{
            icon: Blocks,
            title: tEmpty('skills.title'),
            description: tEmpty('skills.description'),
          }}
          addAction={{
            label: t('addMenu.label'),
            icon: Plus,
            menuItems: [
              {
                label: t('createMenu.blank'),
                icon: Plus,
                onClick: () => setPane({ view: 'create' }),
              },
              {
                label: t('createMenu.uploadZip'),
                icon: FileUp,
                onClick: () => setPane({ view: 'upload', mode: 'zip' }),
              },
              {
                label: t('createMenu.uploadFolder'),
                icon: FolderUp,
                onClick: () => setPane({ view: 'upload', mode: 'folder' }),
              },
            ],
            // The empty state needs a single click target, not a menu — an
            // organization with no skills at all is writing its first one.
            onClick: () => setPane({ view: 'create' }),
          }}
          onRowClick={(row) =>
            setPane({ view: 'detail', slug: row.original.slug })
          }
          clickableRows
          {...list.tableProps}
        />
      </SettingsSection>

      {pane !== null && (
        <SkillPaneDialog
          organizationId={organizationId}
          pane={pane}
          onPaneChange={setPane}
          onClose={() => setPane(null)}
        />
      )}
    </SettingsPage>
  );
}
