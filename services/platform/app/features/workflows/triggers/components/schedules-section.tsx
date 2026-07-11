'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Calendar, Info, Pencil, Trash2 } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Switch } from '@/app/components/ui/forms/switch';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useToast } from '@/app/hooks/use-toast';
import { effectiveScheduleInput } from '@/convex/automations/schedule_variables';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { getMissingRequiredFields } from '../../utils/input-schema-template';
import type { WfSchedule } from '../hooks/queries';
import { useSchedules } from '../hooks/queries';
import { useDeleteSchedule, useToggleSchedule } from '../hooks/slug-mutations';
import { useTriggerTimestamp } from '../hooks/use-trigger-timestamp';
import { useWorkflowInputSchema } from '../hooks/use-workflow-input-schema';
import { CollapsibleSection } from './collapsible-section';
import { ScheduleCreateDialog } from './schedule-create-dialog';

interface SchedulesSectionProps {
  workflowRootId: string;
  organizationId: string;
  workflowSlug: string;
}

type Schedule = WfSchedule;

export function SchedulesSection({
  workflowRootId,
  organizationId,
  workflowSlug,
}: SchedulesSectionProps) {
  const { t } = useT('workflows');
  const { toast } = useToast();
  const { schedules } = useSchedules(organizationId, workflowSlug);

  // The same start-step `inputSchema` the create/edit dialog validates
  // against (#2608) — reused here so a row missing a required variable shows
  // a "needs configuration" badge instead of only failing silently at fire
  // time (#2613).
  const inputSchema = useWorkflowInputSchema(organizationId, workflowSlug);
  const { projects } = useProjects(organizationId);
  const projectNameById = useMemo(
    () => new Map(projects.map((p) => [p._id, p.name])),
    [projects],
  );

  const toggleSchedule = useToggleSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggle = useCallback(
    async (scheduleId: string, isActive: boolean) => {
      try {
        await toggleSchedule.mutateAsync({
          scheduleId: toId<'wfSchedules'>(scheduleId),
          isActive,
        });
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
      await deleteScheduleMutation.mutateAsync({
        scheduleId: deleteTarget._id,
      });
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

  const formatTimestamp = useTriggerTimestamp();

  // A schedule "needs configuration" when the workflow declares required
  // start-schema fields it still leaves blank at fire time — the row's own
  // bound `projectId` counts as filling `projectId` (mirrors the scheduler's
  // own fire-time merge, `effectiveScheduleInput`), so a project-bound
  // schedule that never touched the variables JSON isn't flagged.
  const missingFieldsOf = useCallback(
    (schedule: Schedule): string[] =>
      getMissingRequiredFields(
        inputSchema,
        effectiveScheduleInput(
          schedule.variables ?? undefined,
          schedule.projectId,
        ),
      ),
    [inputSchema],
  );

  const columns = useMemo<ColumnDef<Schedule>[]>(
    () => [
      {
        id: 'cronExpression',
        header: t('triggers.schedules.columns.cronExpression'),
        cell: ({ row }) => (
          <Row gap={2}>
            <code className="bg-muted rounded px-2 py-0.5 font-mono text-sm">
              {row.original.cronExpression}
            </code>
            <Text as="span" variant="caption">
              {row.original.timezone}
            </Text>
          </Row>
        ),
        size: 220,
      },
      {
        id: 'project',
        header: t('triggers.schedules.columns.project'),
        cell: ({ row }) => {
          const projectId = row.original.projectId;
          const projectName = projectId
            ? (projectNameById.get(projectId) ?? projectId)
            : undefined;
          const missingFields = missingFieldsOf(row.original);
          const missingFieldsDetail =
            missingFields.length > 0
              ? t('triggers.schedules.needsConfigurationDetail', {
                  fields: missingFields.join(', '),
                })
              : undefined;
          return (
            <Row gap={2} wrap>
              <Text as="span" variant={projectName ? 'muted' : 'caption'}>
                {projectName ?? t('triggers.schedules.unboundProject')}
              </Text>
              {missingFieldsDetail && (
                <Row gap={1}>
                  <Badge variant="yellow">
                    {t('triggers.schedules.needsConfiguration')}
                  </Badge>
                  {/* Keyboard/SR-reachable affordance for the missing-fields
                      detail (WCAG 2.1 AA) — a native title= tooltip on the
                      badge alone is unreachable without a mouse. */}
                  <Tooltip content={missingFieldsDetail}>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={missingFieldsDetail}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex rounded align-middle focus-visible:ring-1 focus-visible:outline-none"
                    >
                      <Info className="size-3.5" aria-hidden="true" />
                    </button>
                  </Tooltip>
                </Row>
              )}
            </Row>
          );
        },
        size: 200,
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
          <Text as="span" variant="muted">
            {formatTimestamp(row.original.lastTriggeredAt)}
          </Text>
        ),
        size: 180,
      },
      {
        id: 'createdBy',
        header: t('triggers.schedules.columns.createdBy'),
        cell: ({ row }) => (
          <Text as="span" variant="muted">
            {row.original.createdBy}
          </Text>
        ),
        size: 160,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Row gap={1} justify="end">
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
          </Row>
        ),
        size: 100,
      },
    ],
    [t, handleToggle, formatTimestamp, projectNameById, missingFieldsOf],
  );

  return (
    <CollapsibleSection
      id="schedules"
      icon={Calendar}
      title={t('triggers.schedules.title')}
      count={schedules?.length ?? 0}
      defaultOpen={(schedules?.length ?? 0) > 0}
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus className="mr-2 size-4" />
          {t('triggers.schedules.createButton')}
        </Button>
      }
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
        workflowSlug={workflowSlug}
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
