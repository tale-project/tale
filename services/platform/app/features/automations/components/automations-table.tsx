'use client';

import { LinkButton } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { BarChart3, Network } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useListWorkflows } from '../hooks/file-queries';
import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

export interface WorkflowItem {
  type: 'workflow';
  slug: string;
  name: string;
  description?: string;
  stepCount: number;
  hash: string;
  category: string;
  createdAtMs?: number;
}

export interface FolderItem {
  type: 'folder';
  name: string;
  workflowCount: number;
}

export type AutomationTableItem = WorkflowItem | FolderItem;

interface AutomationsTableProps {
  organizationId: string;
  currentFolder?: string;
}

function toWorkflowItem(
  w:
    | {
        slug: string;
        name: string;
        description?: string;
        stepCount: number;
        hash: string;
        createdAtMs?: number;
      }
    | { slug: string; status: string; message: string }
    | null,
): WorkflowItem | null {
  if (!w || !('name' in w)) return null;
  const category = w.slug.includes('/') ? w.slug.split('/')[0] : '';
  return { ...w, type: 'workflow', category };
}

export function AutomationsTable({
  organizationId,
  currentFolder,
}: AutomationsTableProps) {
  const navigate = useNavigate();
  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');
  const [searchQuery, setSearchQuery] = useState('');

  const { workflows, isLoading, refetch } = useListWorkflows(
    organizationId,
    'installed',
  );
  const { columns, searchPlaceholder } =
    useAutomationsTableConfig(organizationId);

  useEffect(() => {
    const handleWorkflowUpdated = () => void refetch();
    window.addEventListener('workflow-updated', handleWorkflowUpdated);
    return () => {
      window.removeEventListener('workflow-updated', handleWorkflowUpdated);
    };
  }, [refetch]);

  const validWorkflows = useMemo(
    () =>
      workflows
        ?.map(toWorkflowItem)
        .filter((w): w is WorkflowItem => w !== null),
    [workflows],
  );

  const tableItems = useMemo((): AutomationTableItem[] => {
    if (!validWorkflows) return [];

    const q = searchQuery.toLowerCase().trim();
    const filtered = q
      ? validWorkflows.filter(
          (w: WorkflowItem) =>
            w.name.toLowerCase().includes(q) ||
            w.category.toLowerCase().includes(q) ||
            (w.description && w.description.toLowerCase().includes(q)),
        )
      : validWorkflows;

    if (currentFolder) {
      return filtered
        .filter((w: WorkflowItem) => w.category === currentFolder)
        .sort((a: WorkflowItem, b: WorkflowItem) =>
          a.name.localeCompare(b.name),
        );
    }

    const folderMap = new Map();
    const rootWorkflows: WorkflowItem[] = [];

    for (const w of filtered) {
      if (w.category) {
        folderMap.set(w.category, (folderMap.get(w.category) ?? 0) + 1);
      } else {
        rootWorkflows.push(w);
      }
    }

    const folderItems: FolderItem[] = [...folderMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ type: 'folder', name, workflowCount: count }));

    rootWorkflows.sort((a, b) => a.name.localeCompare(b.name));

    return [...folderItems, ...rootWorkflows];
  }, [validWorkflows, searchQuery, currentFolder]);

  const handleRowClick = useCallback(
    (row: Row<AutomationTableItem>) => {
      const item = row.original;
      if (item.type === 'folder') {
        void navigate({
          to: '/dashboard/$id/automations',
          params: { id: organizationId },
          search: { folder: item.name },
        });
      } else {
        const amId = slugToUrlParam(item.slug);
        void navigate({
          to: '/dashboard/$id/automations/$amId',
          params: { id: organizationId, amId },
          search: { panel: 'ai-chat' },
        });
      }
    },
    [navigate, organizationId],
  );

  const getRowClassName = useCallback(
    (row: Row<AutomationTableItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <SearchInput
          wrapperClassName="w-full max-w-sm"
          placeholder={tAutomations('search.placeholder')}
          aria-label={tAutomations('search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <LinkButton
            href="/dashboard/$id/automations/metrics"
            params={{ id: organizationId }}
            variant="secondary"
            icon={BarChart3}
          >
            {tAutomations('metrics.link')}
          </LinkButton>
          <AutomationsActionMenu organizationId={organizationId} />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={tableItems}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : tableItems.length}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: () => {},
          entityLabel: tAutomations('entityLabel'),
          totalCount: validWorkflows?.length ?? 0,
        }}
        emptyState={
          searchQuery
            ? {
                title: tCommon('search.noResults'),
              }
            : {
                icon: Network,
                title: tEmpty('automations.title'),
                description: tEmpty('automations.description'),
              }
        }
      />
    </div>
  );
}
