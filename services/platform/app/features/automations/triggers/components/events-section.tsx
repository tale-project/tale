'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Plus, Zap, Trash2, Pencil } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WfEventSubscription } from '@/lib/collections/entities/wf-event-subscriptions';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Switch } from '@/app/components/ui/forms/switch';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import {
  EVENT_TYPES,
  getFilterFieldsForEventType,
} from '@/convex/workflows/triggers/event_types';
import { useT } from '@/lib/i18n/client';

import { useAutomationRootCollection } from '../../hooks/collections';
import { useAutomationRoots } from '../../hooks/queries';
import { useEventSubscriptionCollection } from '../hooks/collections';
import {
  useDeleteEventSubscription,
  useToggleEventSubscription,
} from '../hooks/mutations';
import { useEventSubscriptions } from '../hooks/queries';
import { CollapsibleSection } from './collapsible-section';
import { EventCreateDialog } from './event-create-dialog';

interface EventsSectionProps {
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
}

type EventSubscription = WfEventSubscription;

export function EventsSection({
  workflowRootId,
  organizationId,
}: EventsSectionProps) {
  const { t } = useT('automations');
  const { toast } = useToast();
  const eventSubscriptionCollection =
    useEventSubscriptionCollection(workflowRootId);
  const { subscriptions } = useEventSubscriptions(eventSubscriptionCollection);

  const automationRootCollection = useAutomationRootCollection(organizationId);
  const { automationRoots: workflows } = useAutomationRoots(
    automationRootCollection,
  );

  const workflowNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (workflows) {
      for (const w of workflows) {
        map.set(w._id, w.name);
      }
    }
    return map;
  }, [workflows]);

  const toggleSubscription = useToggleEventSubscription();
  const deleteSubscriptionMutation = useDeleteEventSubscription();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventSubscription | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventSubscription | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const handleToggle = useCallback(
    async (subscriptionId: Id<'wfEventSubscriptions'>, isActive: boolean) => {
      try {
        await toggleSubscription({ subscriptionId, isActive });
        toast({
          title: isActive
            ? t('triggers.events.toast.enabled')
            : t('triggers.events.toast.disabled'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('triggers.events.toast.toggleError'),
          variant: 'destructive',
        });
      }
    },
    [toggleSubscription, toast, t],
  );

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteSubscriptionMutation({ subscriptionId: deleteTarget._id });
      toast({
        title: t('triggers.events.toast.deleted'),
        variant: 'success',
      });
      setDeleteTarget(null);
    } catch {
      toast({
        title: t('triggers.events.toast.deleteError'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, deleteSubscriptionMutation, toast, t]);

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

  const getEventLabel = useCallback((eventType: string) => {
    const meta = EVENT_TYPES[eventType];
    return meta?.label ?? eventType;
  }, []);

  const resolveFilterLabel = useCallback(
    (eventType: string, key: string, value: string) => {
      const fields = getFilterFieldsForEventType(eventType);
      const field = fields.find((f) => f.key === key);
      if (!field) return `${key}: ${value}`;

      if (field.inputType === 'workflow-select') {
        const name = workflowNameMap.get(value);
        return `${field.label}: ${name ?? value}`;
      }

      if (field.inputType === 'select' && field.options) {
        const opt = field.options.find((o) => o.value === value);
        return `${field.label}: ${opt?.label ?? value}`;
      }

      return `${field.label}: ${value}`;
    },
    [workflowNameMap],
  );

  const columns = useMemo<ColumnDef<EventSubscription>[]>(
    () => [
      {
        id: 'eventType',
        header: t('triggers.events.columns.eventType'),
        cell: ({ row }) => {
          const { eventType, eventFilter } = row.original;
          const filterEntries = eventFilter ? Object.entries(eventFilter) : [];
          return (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <code className="bg-muted rounded px-2 py-0.5 font-mono text-sm">
                  {eventType}
                </code>
                <span className="text-muted-foreground text-xs">
                  {getEventLabel(eventType)}
                </span>
              </div>
              {filterEntries.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {filterEntries.map(([key, value]) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {resolveFilterLabel(eventType, key, String(value))}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        },
        size: 320,
      },
      {
        id: 'active',
        header: t('triggers.events.columns.active'),
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            onCheckedChange={(checked) =>
              handleToggle(row.original._id, checked)
            }
            aria-label={t('triggers.events.columns.active')}
          />
        ),
        size: 80,
      },
      {
        id: 'lastTriggered',
        header: t('triggers.events.columns.lastTriggered'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(row.original.lastTriggeredAt)}
          </span>
        ),
        size: 180,
      },
      {
        id: 'createdBy',
        header: t('triggers.events.columns.createdBy'),
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
              onClick={() => setEditTarget(row.original)}
              aria-label={t('triggers.events.editTitle')}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t('triggers.events.deleteTitle')}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ),
        size: 100,
      },
    ],
    [t, handleToggle, formatDate, getEventLabel, resolveFilterLabel],
  );

  return (
    <CollapsibleSection
      id="events"
      icon={Zap}
      title={t('triggers.events.title')}
    >
      <DataTable
        columns={columns}
        data={subscriptions ?? []}
        caption={t('triggers.events.title')}
        getRowId={(row) => row._id}
        emptyState={{
          icon: Zap,
          title: t('triggers.events.emptyTitle'),
          description: t('triggers.events.emptyDescription'),
        }}
        actionMenu={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus className="mr-2 size-4" />
            {t('triggers.events.createButton')}
          </Button>
        }
      />

      <EventCreateDialog
        open={isCreateOpen || !!editTarget}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setIsCreateOpen(false);
            setEditTarget(null);
          }
        }}
        workflowRootId={workflowRootId}
        organizationId={organizationId}
        existingEventTypes={subscriptions?.map((s) => s.eventType) ?? []}
        editing={
          editTarget
            ? {
                _id: editTarget._id,
                eventType: editTarget.eventType,
                eventFilter: editTarget.eventFilter,
              }
            : null
        }
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('triggers.events.deleteTitle')}
        description={t('triggers.events.deleteDescription')}
        isDeleting={isDeleting}
        onDelete={handleDelete}
      />
    </CollapsibleSection>
  );
}
