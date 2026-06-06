'use client';

import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Sparkles } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useDeleteSkill } from '../hooks/mutations';
import { useListSkills } from '../hooks/queries';
import {
  useSkillsTableConfig,
  type SkillsTableBindingMode,
} from '../hooks/use-skills-table-config';
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
  /**
   * Enables a leading checkbox column wired to the supplied selection state.
   * Also flips the detail panel into read-only mode (no Replace/Duplicate/Delete)
   * since the agent-binding context has no business managing the bundle.
   */
  bindingMode?: SkillsTableBindingMode;
  /** Hides the trailing action menu (e.g. Upload skill). Settings keeps it; agent context drops it. */
  hideActionMenu?: boolean;
  /** Pre-opens the detail panel for this slug on mount (used by ?slug= deep-link). */
  initialDetailSlug?: string | null;
  /**
   * Replaces the default empty-state description (and optionally the title)
   * when the org has 0 skills. Used by the agent Skills tab to point users to
   * the org Skills settings instead of the generic marketing copy.
   */
  emptyStateOverride?: { title?: string; description: ReactNode };
}

export function SkillsTable({
  organizationId,
  bindingMode,
  hideActionMenu,
  initialDetailSlug,
  emptyStateOverride,
}: SkillsTableProps) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const queryClient = useQueryClient();
  const [detailSlug, setDetailSlug] = useState(initialDetailSlug ?? null);
  // Re-sync when the URL param changes (e.g. nav between two ?slug= URLs).
  useEffect(() => {
    if (initialDetailSlug != null) setDetailSlug(initialDetailSlug);
  }, [initialDetailSlug]);
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

  // Bulk delete is only offered in the settings context (no `bindingMode`),
  // where rows aren't already claimed by the agent-binding checkbox column.
  const bulkDeletable = bindingMode == null;
  const { mutateAsync: deleteSkill } = useDeleteSkill();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleBulkDeleteItem = useCallback(
    // Reuses the single-row delete mutation; the bar batches + toasts.
    async (slug: string) => {
      await deleteSkill({ organizationId, slug });
    },
    [deleteSkill, organizationId],
  );

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useSkillsTableConfig({
      organizationId,
      onDeleted: invalidateSkills,
      onDuplicated: setDetailSlug,
      bindingMode,
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
    // Omit approxRowCount so the table shows the shared default skeleton-row
    // count while the first page loads (matches agents/other tables).
    search: {
      fields: ['name', 'slug', 'description'],
      placeholder: searchPlaceholder,
    },
    entityLabel: t('skills.entityLabel'),
  });

  const bindingCaption = bindingMode ? (
    <HStack justify="end" align="center" className="px-1" aria-live="polite">
      <Text variant="caption">
        {t('agents.form.skillBindingsCounter', {
          defaultValue: '{count}/{max} bound',
          count: bindingMode.selected.length,
          max: bindingMode.max,
        })}
      </Text>
    </HStack>
  ) : null;

  // Shared anchor for at-cap rows' aria-describedby; matches the id used in
  // use-skills-table-config.tsx. Only rendered when bindings are active.
  const atCapReason = bindingMode ? (
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
  ) : null;

  return (
    <Stack gap={2}>
      {atCapReason}
      {bindingCaption}
      <DataTable
        {...list.tableProps}
        columns={columns}
        stickyLayout={stickyLayout}
        enableRowSelection={bulkDeletable}
        rowSelection={bulkDeletable ? rowSelection : undefined}
        onRowSelectionChange={bulkDeletable ? setRowSelection : undefined}
        getRowId={bulkDeletable ? (row) => row.slug : undefined}
        footer={
          bulkDeletable ? (
            <BulkDeleteBar
              rowSelection={rowSelection}
              onClearSelection={handleClearSelection}
              onDeleteItem={handleBulkDeleteItem}
              onDeleteComplete={() => {
                handleClearSelection();
                invalidateSkills();
              }}
            />
          ) : undefined
        }
        onRowClick={handleRowClick}
        actionMenu={
          hideActionMenu ? undefined : (
            <SkillsActionMenu
              organizationId={organizationId}
              onUploaded={setDetailSlug}
            />
          )
        }
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
          readOnly={bindingMode != null}
          manageLink={
            bindingMode != null
              ? {
                  to: '/dashboard/$id/settings/skills',
                  params: { id: organizationId },
                  search: { slug: detailSlug },
                }
              : undefined
          }
        />
      )}
    </Stack>
  );
}
