'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row } from '@tanstack/react-table';
import { Sparkles } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useListSkills } from '../hooks/queries';
import { useSkillsTableConfig } from '../hooks/use-skills-table-config';
import { SkillsActionMenu } from './skills-action-menu';

export interface SkillRow {
  slug: string;
  name: string;
  description: string;
  toolNames?: string[];
  integrationBindings?: string[];
  workflowBindings?: string[];
  status?: string;
  message?: string;
}

interface SkillsTableProps {
  organizationId: string;
}

export function SkillsTable({ organizationId }: SkillsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { skills: rawSkills, isLoading } = useListSkills(organizationId);

  const skills = useMemo<SkillRow[]>(() => {
    if (!Array.isArray(rawSkills)) return [];
    const valid: SkillRow[] = [];
    for (const s of rawSkills) {
      if (!s || typeof s.slug !== 'string') continue;
      // Skills with read errors come back with `status`/`message` and no name.
      if ('status' in s && typeof s.status === 'string') continue;
      if (typeof s.name !== 'string' || typeof s.description !== 'string') {
        continue;
      }
      valid.push({
        slug: s.slug,
        name: s.name,
        description: s.description,
        toolNames: s.toolNames,
        integrationBindings: s.integrationBindings,
        workflowBindings: s.workflowBindings,
      });
    }
    return valid;
  }, [rawSkills]);

  const invalidateSkills = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'skills'] });
  }, [queryClient]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useSkillsTableConfig({
      organizationId,
      onDeleted: invalidateSkills,
    });

  const handleRowClick = useCallback(
    (row: Row<SkillRow>) => {
      void navigate({
        to: '/dashboard/$id/skills/$skillSlug',
        params: {
          id: organizationId,
          skillSlug: row.original.slug,
        },
      });
    },
    [navigate, organizationId],
  );

  const list = useListPage<SkillRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : skills,
    },
    pageSize,
    search: {
      fields: ['name', 'slug', 'description'],
      placeholder: searchPlaceholder,
    },
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      onRowClick={handleRowClick}
      actionMenu={<SkillsActionMenu organizationId={organizationId} />}
      emptyState={{
        icon: Sparkles,
        title: tEmpty('skills.title', { defaultValue: 'No skills yet' }),
        description: tEmpty('skills.description', {
          defaultValue:
            'Skills are reusable instruction bundles you can attach to agents — like a playbook plus optional scripts.',
        }),
      }}
    />
  );
}
