'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { Row } from '@tanstack/react-table';
import { Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useListSkills } from '../hooks/queries';
import { useSkillsTableConfig } from '../hooks/use-skills-table-config';
import { SkillDetailPanel } from './skill-detail-panel';
import { SkillsActionMenu } from './skills-action-menu';

export interface SkillRow {
  slug: string;
  name: string;
  description: string;
  /** SHA-256 of SKILL.md at list-time, forwarded to deleteSkill for CAS. */
  hash?: string;
  status?: string;
  message?: string;
}

interface SkillsTableProps {
  organizationId: string;
}

export function SkillsTable({ organizationId }: SkillsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const queryClient = useQueryClient();
  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const {
    skills: rawSkills,
    isLoading,
    error,
    refetch,
  } = useListSkills(organizationId);

  const skills = useMemo<SkillRow[]>(() => {
    if (!Array.isArray(rawSkills)) return [];
    const rows: SkillRow[] = [];
    for (const s of rawSkills) {
      if (!s || typeof s.slug !== 'string') continue;
      // Skills with read errors come back with `status`/`message` and no
      // name. Render them as rows with a warning indicator so admins can
      // find and fix them instead of having broken SKILL.md files vanish
      // silently from the list.
      if ('status' in s && typeof s.status === 'string') {
        rows.push({
          slug: s.slug,
          name: s.slug,
          description: '',
          status: s.status,
          message: typeof s.message === 'string' ? s.message : undefined,
        });
        continue;
      }
      if (typeof s.name !== 'string' || typeof s.description !== 'string') {
        continue;
      }
      rows.push({
        slug: s.slug,
        name: s.name,
        description: s.description,
        hash: typeof s.hash === 'string' ? s.hash : undefined,
      });
    }
    return rows;
  }, [rawSkills]);

  const invalidateSkills = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'skills'] });
  }, [queryClient]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useSkillsTableConfig({
      organizationId,
      onDeleted: invalidateSkills,
    });

  const handleRowClick = useCallback((row: Row<SkillRow>) => {
    setDetailSlug(row.original.slug);
  }, []);

  const list = useListPage<SkillRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : skills,
    },
    pageSize,
    approxRowCount: pageSize,
    search: {
      fields: ['name', 'slug', 'description'],
      placeholder: searchPlaceholder,
    },
  });

  return (
    <>
      <DataTable
        className="p-4"
        {...list.tableProps}
        columns={columns}
        stickyLayout={stickyLayout}
        onRowClick={handleRowClick}
        actionMenu={
          <SkillsActionMenu
            organizationId={organizationId}
            onCreated={setDetailSlug}
          />
        }
        error={error ?? undefined}
        onRetry={() => void refetch()}
        emptyState={{
          icon: Sparkles,
          title: tEmpty('skills.title', { defaultValue: 'No skills yet' }),
          description: tEmpty('skills.description', {
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
        />
      )}
    </>
  );
}
