'use client';

import { useNavigate } from '@tanstack/react-router';
import { type Row } from '@tanstack/react-table';
import { Folder, FolderTree, List, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useListWorkflows } from '../hooks/file-queries';
import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

export interface WorkflowListItem {
  slug: string;
  name: string;
  description?: string;
  enabled: boolean;
  version?: string;
  stepCount: number;
  hash: string;
  category: string;
}

interface WorkflowGroup {
  category: string;
  workflows: WorkflowListItem[];
}

interface AutomationsTableProps {
  organizationId: string;
}

function toWorkflowListItem(
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
): WorkflowListItem | null {
  if (!w || !('name' in w)) return null;
  const category = w.slug.includes('/') ? w.slug.split('/')[0] : '';
  return { ...w, category };
}

type ViewMode = 'folder' | 'list';

export function AutomationsTable({ organizationId }: AutomationsTableProps) {
  const navigate = useNavigate();
  const { t: tAutomations } = useT('automations');
  const { t: tEmpty } = useT('emptyStates');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('folder');

  const { workflows, isLoading, refetch } = useListWorkflows(
    'default',
    'installed',
  );
  const { columns, listColumns } = useAutomationsTableConfig();

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
        ?.map(toWorkflowListItem)
        .filter((w): w is WorkflowListItem => w !== null),
    [workflows],
  );

  const filteredWorkflows = useMemo(() => {
    if (!validWorkflows) return [];
    if (!searchQuery.trim()) return validWorkflows;
    const q = searchQuery.toLowerCase();
    return validWorkflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q)),
    );
  }, [validWorkflows, searchQuery]);

  const groups = useMemo((): WorkflowGroup[] => {
    const groupMap = new Map<string, WorkflowListItem[]>();
    for (const w of filteredWorkflows) {
      const key = w.category || '';
      const list = groupMap.get(key) ?? [];
      list.push(w);
      groupMap.set(key, list);
    }

    const result: WorkflowGroup[] = [];
    for (const [category, items] of groupMap) {
      items.sort((a, b) => a.name.localeCompare(b.name));
      result.push({ category, workflows: items });
    }
    result.sort((a, b) => {
      if (!a.category) return 1;
      if (!b.category) return -1;
      return a.category.localeCompare(b.category);
    });
    return result;
  }, [filteredWorkflows]);

  const handleRowClick = useCallback(
    (row: Row<WorkflowListItem>) => {
      const amId = slugToUrlParam(row.original.slug);
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId },
        search: { panel: 'ai-chat' },
      });
    },
    [navigate, organizationId],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Text as="span" variant="caption">
          Loading...
        </Text>
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
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-9 w-full max-w-sm rounded-md border px-3 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            placeholder={tAutomations('search.placeholder')}
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearchQuery(e.target.value)
            }
          />
          <div className="border-input flex h-9 items-center rounded-md border">
            <button
              type="button"
              className={cn(
                'flex h-full items-center gap-1 px-2.5 text-sm transition-colors',
                viewMode === 'folder'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setViewMode('folder')}
              aria-label="Folder view"
            >
              <FolderTree className="size-4" />
            </button>
            <button
              type="button"
              className={cn(
                'flex h-full items-center gap-1 px-2.5 text-sm transition-colors',
                viewMode === 'list'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
        <AutomationsActionMenu organizationId={organizationId} />
      </div>

      {viewMode === 'folder' ? (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <FolderGroup
              key={group.category || '__root__'}
              group={group}
              columns={columns}
              onRowClick={handleRowClick}
            />
          ))}
        </div>
      ) : (
        <DataTable
          columns={listColumns}
          data={filteredWorkflows}
          onRowClick={handleRowClick}
        />
      )}

      {filteredWorkflows.length === 0 && searchQuery && (
        <div className="flex flex-col items-center justify-center gap-2 p-8">
          <Text as="span" variant="caption">
            No results found
          </Text>
        </div>
      )}
    </div>
  );
}

interface FolderGroupProps {
  group: WorkflowGroup;
  columns: ReturnType<typeof useAutomationsTableConfig>['columns'];
  onRowClick: (row: Row<WorkflowListItem>) => void;
}

function FolderGroup({ group, columns, onRowClick }: FolderGroupProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-lg border">
      <button
        type="button"
        aria-expanded={isOpen}
        className="hover:bg-muted/50 flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <svg
          className={cn(
            'size-3.5 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-90',
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <Folder className="text-muted-foreground size-4" />
        <Text as="span" variant="label" className="flex-1">
          {group.category || '/'}
        </Text>
        <Badge variant="outline">{group.workflows.length}</Badge>
      </button>

      {isOpen && (
        <div className="border-t">
          <DataTable
            columns={columns}
            data={group.workflows}
            onRowClick={onRowClick}
          />
        </div>
      )}
    </section>
  );
}
