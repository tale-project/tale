'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { Row } from '@tanstack/react-table';
import { Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useListSkills } from '../hooks/queries';
import {
  useSkillsTableConfig,
  type SkillsTableBindingMode,
} from '../hooks/use-skills-table-config';
import { toSkillRows, type SkillRow } from '../lib/skill-rows';
import { SkillDetailPanel } from './skill-detail-panel';

interface SkillsTableProps {
  organizationId: string;
  /**
   * The agent-binding selection this table exists for: a leading checkbox
   * column wired to the supplied selection state. The detail panel opens
   * read-only (no Replace/Duplicate/Delete) since the agent-binding context
   * has no business managing the bundle — org-level skill management lives in
   * the Skills settings catalog (`SkillsCatalog`).
   */
  bindingMode: SkillsTableBindingMode;
  /**
   * Replaces the default empty-state description (and optionally the title)
   * when the org has 0 skills. Used by the agent Skills tab to point users to
   * the org Skills settings instead of the generic marketing copy.
   */
  emptyStateOverride?: { title?: string; description: ReactNode };
  /** Slugs hidden from the table (e.g. workflow disciplines on external agents). */
  excludeSlugs?: ReadonlySet<string>;
}

export function SkillsTable({
  organizationId,
  bindingMode,
  emptyStateOverride,
  excludeSlugs,
}: SkillsTableProps) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const {
    skills: rawSkills,
    isLoading,
    error,
    refetch,
  } = useListSkills(organizationId);

  const skills = useMemo(() => toSkillRows(rawSkills), [rawSkills]);

  const filteredSkills = useMemo(() => {
    if (!excludeSlugs || excludeSlugs.size === 0) return skills;
    return skills.filter((s) => !excludeSlugs.has(s.slug));
  }, [skills, excludeSlugs]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useSkillsTableConfig({ bindingMode });

  const handleRowClick = useCallback((row: Row<SkillRow>) => {
    setDetailSlug(row.original.slug);
  }, []);

  const list = useListPage<SkillRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : filteredSkills,
    },
    pageSize,
    // Omit approxRowCount so the table shows the shared default skeleton-row
    // count while the first page loads (matches agents/other tables).
    search: {
      fields: ['name', 'slug', 'description'],
      placeholder: searchPlaceholder,
    },
    entityLabel: t('skills.entityLabel'),
  });

  const bindingCaption = (
    <HStack justify="end" align="center" className="px-1" aria-live="polite">
      <Text variant="caption">
        {t('agents.form.skillBindingsCounter', {
          defaultValue: '{count}/{max} bound',
          count: bindingMode.selected.length,
          max: bindingMode.max,
        })}
      </Text>
    </HStack>
  );

  // Shared anchor for at-cap rows' aria-describedby; matches the id used in
  // use-skills-table-config.tsx.
  const atCapReason = (
    <Text
      as="span"
      id="skill-binding-at-cap-reason"
      variant="caption"
      className="sr-only"
    >
      {t('agents.form.skillBindingsAtCapReason', {
        defaultValue: 'Maximum {max} skills bound — unbind one to add another.',
        max: bindingMode.max,
      })}
    </Text>
  );

  return (
    <Stack gap={4}>
      {atCapReason}
      {bindingCaption}
      <DataTable
        {...list.tableProps}
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        error={error ?? undefined}
        onRetry={() => void refetch()}
        emptyState={{
          icon: Sparkles,
          title:
            emptyStateOverride?.title ??
            tEmpty('skills.title', { defaultValue: 'No skills yet' }),
          description:
            emptyStateOverride?.description ??
            tEmpty('skills.description', {
              defaultValue:
                'Skills are reusable instruction bundles you can attach to agents — like a playbook plus optional scripts.',
            }),
        }}
      />
      {detailSlug != null && (
        <SkillDetailPanel
          organizationId={organizationId}
          slug={detailSlug}
          onOpenChange={(open) => {
            if (!open) setDetailSlug(null);
          }}
          onSwitchSlug={setDetailSlug}
          readOnly
          manageLink={{
            to: '/dashboard/$id/settings/skills',
            params: { id: organizationId },
            search: { slug: detailSlug },
          }}
        />
      )}
    </Stack>
  );
}
