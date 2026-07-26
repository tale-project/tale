'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

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
import { useT } from '@/lib/i18n/client';

import { useSkills } from '../hooks/queries';

interface SkillSummary {
  slug: string;
  description: string;
  visibility: 'private' | 'org';
  icon?: string;
  labels?: string[];
  canEdit: boolean;
}

const skillHaystack = (skill: SkillSummary) => [
  skill.slug,
  skill.description,
  ...(skill.labels ?? []),
];

/**
 * The org's skill library: every `SKILL.md` bundle the viewer may see, as
 * catalog cards. Skills are knowledge packs agents READ (never execute); a
 * private skill is visible to its owner only, an org skill to everyone.
 * The library is browse-only — bundles arrive and change through package
 * uploads, so there is no create or edit entry here. Unreadable bundles
 * surface as an operator banner instead of vanishing — a broken file is a
 * fact the admin needs, not a silent hole in the grid.
 */
export function SkillsCatalog({
  organizationId,
  onOpen,
}: {
  organizationId: string;
  /** Open a skill's detail page (deep-linkable `?slug=` on the route). */
  onOpen: (slug: string) => void;
}) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [query, setQuery] = useState('');

  const skillsQuery = useSkills(organizationId);
  const skills: SkillSummary[] = skillsQuery.data?.skills ?? [];
  const failures = skillsQuery.data?.failures ?? [];

  const filtered = useCatalogSearch(skills, query, skillHaystack);

  return (
    <Stack gap={4}>
      <CatalogToolbar
        search={{
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: t('skills.searchPlaceholder'),
        }}
      />

      {skillsQuery.isError && (
        <Alert variant="destructive" description={t('skills.listFailed')} />
      )}
      {failures.length > 0 && (
        <Alert
          variant="destructive"
          title={t('skills.columns.loadError')}
          description={
            <ul className="list-inside list-disc">
              {failures.map((failure) => (
                <li key={failure.path}>
                  <code>{failure.path}</code> — {failure.message}
                </li>
              ))}
            </ul>
          }
        />
      )}

      {skillsQuery.isPending ? (
        <Skeletonize loading>
          <CatalogGridSkeleton />
        </Skeletonize>
      ) : filtered.length === 0 ? (
        <Stack gap={2} align="center" className="py-12 text-center">
          <Text as="p" className="font-medium">
            {skills.length === 0
              ? tEmpty('skills.title')
              : t('skills.noResults.title')}
          </Text>
          <Text as="p" variant="muted" className="max-w-md">
            {skills.length === 0
              ? tEmpty('skills.description')
              : t('skills.noResults.description')}
          </Text>
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
                skill.visibility === 'private' ? (
                  <Badge variant="outline">
                    {t('skills.visibility.private')}
                  </Badge>
                ) : undefined
              }
              meta={<CatalogLabels labels={skill.labels} tone="quiet" />}
              description={skill.description}
              onClick={() => onOpen(skill.slug)}
              ariaLabel={t('skills.openSkill', { slug: skill.slug })}
            />
          ))}
        </CatalogGrid>
      )}
    </Stack>
  );
}
