'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from 'convex/react';
import type { ColumnDef } from '@tanstack/react-table';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { Button } from '@/app/components/ui/primitives/button';
import { Stack } from '@/app/components/ui/layout/layout';
import { Switch } from '@/app/components/ui/forms/switch';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Plus, Calendar, Pencil, Trash2 } from 'lucide-react';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/app/hooks/use-toast';
import { useToggleSchedule, useDeleteSchedule } from '../hooks/use-trigger-mutations';
import { ScheduleCreateDialog } from './schedule-create-dialog';

interface SchedulesSectionProps {
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
}

// Infer the schedule type from the query result
type Schedule = NonNullable<ReturnType<typeof useQuery<typeof api.workflows.triggers.queries.getSchedules>>>[number];

export function SchedulesSection({
  workflowRootId,
  organizationId,
}: SchedulesSectionProps) {
  const { t } = useT('automations');
  const { toast } = useToast();
  const schedules = useQuery(api.workflows.triggers.queries.getSchedules, {
    workflowRootId,
  });

  const toggleSchedule = useToggleSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggle = useCallback(async (scheduleId: Id<'wfSchedules'>, isActive: boolean) => {
    try {
      await toggleSchedule({ scheduleId, isActive });
      toast({
        title: isActive
          ? t('triggers.schedules.toast.enabled')
          : t('triggers.schedules.toast.disabled'),
        variant: 'success',
      });
    } catch {
      toast({ title: 'Failed to toggle schedule', variant: 'destructive' });
    }
  }, [toggleSchedule, toast, t]);

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
      toast({ title: 'Failed to delete schedule', variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteScheduleMutation, toast, t]);

  const formatDate = useCallback((timestamp?: number) => {
    if (!timestamp) return t('triggers.common.never');
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }, [t]);

  const columns = useMemo<ColumnDef<Schedule>[]>(
    () => [
      {
        id: 'cronExpression',
        header: t('triggers.schedules.columns.cronExpression'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
              {row.original.cronExpression}
            </code>
            <span className="text-xs text-muted-foreground">
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
          <span className="text-sm text-muted-foreground">
            {formatDate(row.original.lastTriggeredAt)}
          </span>
        ),
        size: 180,
      },
      {
        id: 'createdBy',
        header: t('triggers.schedules.columns.createdBy'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.createdBy}
          </span>
        ),
        size: 160,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-1 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditSchedule(row.original)}
              aria-label="Edit schedule"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label="Delete schedule"
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
    <Stack gap={4} className="pt-4">
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
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus className="size-4 mr-2" />
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
    </Stack>
  );
}
