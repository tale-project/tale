'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableSkeleton } from '@/app/components/ui/data-table/data-table-skeleton';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useListWorkflows } from '../hooks/file-queries';
import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

export interface WorkflowItem {
  type: 'workflow';
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  version?: string;
  stepCount: number;
  hash: string;
  category: string;
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
        enabled: boolean;
        version?: string;
        stepCount: number;
        hash: string;
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
    'default',
    'installed',
  );
  const { columns, searchPlaceholder } = useAutomationsTableConfig();

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
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.category.toLowerCase().includes(q) ||
            (w.description && w.description.toLowerCase().includes(q)),
        )
      : validWorkflows;

    if (currentFolder) {
      return filtered
        .filter((w) => w.category === currentFolder)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const folderMap = new Map<string, number>();
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

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <DataTableSkeleton
          columns={columns}
          rows={5}
          searchPlaceholder={searchPlaceholder}
          noFirstColumnAvatar
          actionMenu={<AutomationsActionMenu organizationId={organizationId} />}
        />
      </div>
    );
  }

  if (!validWorkflows || validWorkflows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <Workflow className="text-muted-foreground size-10" />
        <Text as="span" variant="label">
          {tEmpty('automations.title')}
        </Text>
        <Text as="span" variant="caption">
          {tEmpty('automations.description')}
        </Text>
        <AutomationsActionMenu organizationId={organizationId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full max-w-sm rounded-md border px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          placeholder={tAutomations('search.placeholder')}
          aria-label={tAutomations('search.placeholder')}
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearchQuery(e.target.value)
          }
        />
        <AutomationsActionMenu organizationId={organizationId} />
      </div>

      <DataTable
        columns={columns}
        data={tableItems}
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
      />

      {tableItems.length === 0 && searchQuery && (
        <div className="flex flex-col items-center justify-center gap-2 p-8">
          <Text as="span" variant="caption">
            {tCommon('search.noResults')}
          </Text>
        </div>
      )}
    </div>
  );
}
