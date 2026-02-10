'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type { FunctionReturnType } from 'convex/server';

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { Plus, Calendar, Pencil, Trash2 } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import {
  useToggleSchedule,
  useDeleteSchedule,
} from '../hooks/use-trigger-mutations';
import { CollapsibleSection } from './collapsible-section';
import { ScheduleCreateDialog } from './schedule-create-dialog';

interface SchedulesSectionProps {
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
}

// Infer the schedule type from the query result
type Schedule = NonNullable<
  FunctionReturnType<typeof api.workflows.triggers.queries.getSchedules>
>[number];

export function SchedulesSection({
  workflowRootId,
  organizationId,
}: SchedulesSectionProps) {
  const { t } = useT('automations');
  const { toast } = useToast();
  const { data: schedules } = useQuery(
    convexQuery(api.workflows.triggers.queries.getSchedules, {
      workflowRootId,
    }),
  );

  const toggleSchedule = useToggleSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggle = useCallback(
    async (scheduleId: Id<'wfSchedules'>, isActive: boolean) => {
      try {
        await toggleSchedule({ scheduleId, isActive });
        toast({
          title: isActive
            ? t('triggers.schedules.toast.enabled')
            : t('triggers.schedules.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('triggers.schedules.toast.toggleError'),
          variant: 'destructive',
        });
      }
    },
    [toggleSchedule, toast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteScheduleMutation({ scheduleId: deleteTarget._id });
      toast({
        title: t('triggers.schedules.toast.deleted'),
        variant: 'success',
      });
      setDeleteTarget(null);
    } catch {
      toast({
        title: t('triggers.schedules.toast.deleteError'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteScheduleMutation, toast, t]);

  const formatDate = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('triggers.common.never');
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(timestamp));
    },
    [t],
  );

  const columns = useMemo<ColumnDef<Schedule>[]>(
    () => [
      {
        id: 'cronExpression',
        header: t('triggers.schedules.columns.cronExpression'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <code className="bg-muted rounded px-2 py-0.5 font-mono text-sm">
              {row.original.cronExpression}
            </code>
            <span className="text-muted-foreground text-xs">
              {row.original.timezone}
            </span>
          </div>
        ),
        size: 220,
      },
      {
        id: 'active',
        header: t('triggers.schedules.columns.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              handleToggle(row.original._id, checked)
            }
            aria-label={t('triggers.schedules.columns.active')}
          />
        ),
        size: 80,
      },
      {
        id: 'lastTriggered',
        header: t('triggers.schedules.columns.lastTriggered'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.lastTriggeredAt)}
          </span>
        ),
        size: 180,
      },
      {
        id: 'createdBy',
        header: t('triggers.schedules.columns.createdBy'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {row.original.createdBy}
          </span>
        ),
        size: 160,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditSchedule(row.original)}
              aria-label={t('triggers.schedules.form.editTitle')}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t('triggers.schedules.deleteTitle')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
        size: 100,
      },
    ],
    [t, handleToggle, formatDate],
  );

  return (
    <CollapsibleSection
      id="schedules"
      icon={Calendar}
      title={t('triggers.schedules.title')}
      defaultOpen
    >
      <DataTable
        columns={columns}
        data={schedules ?? []}
        caption={t('triggers.schedules.title')}
        getRowId={(row) => row._id}
        emptyState={{
          icon: Calendar,
          title: t('triggers.schedules.emptyTitle'),
          description: t('triggers.schedules.emptyDescription'),
        }}
        actionMenu={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="mr-2 size-4" />
            {t('triggers.schedules.createButton')}
          </Button>
        }
      />

      <ScheduleCreateDialog
        open={isCreateOpen || !!editSchedule}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditSchedule(null);
          }
        }}
        workflowRootId={workflowRootId}
        organizationId={organizationId}
        schedule={editSchedule}
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('triggers.schedules.deleteTitle')}
        description={t('triggers.schedules.deleteDescription')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </CollapsibleSection>
  );
}
