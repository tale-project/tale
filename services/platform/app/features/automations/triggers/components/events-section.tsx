'use client';

import type { ColumnDef } from '@tanstack/react-table';

import { Plus, Zap, Trash2, Pencil } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { Switch } from '@/app/components/ui/forms/switch';
import { HStack, VStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useToast } from '@/app/hooks/use-toast';
import {
  EVENT_TYPES,
  getFilterFieldsForEventType,
} from '@/convex/workflows/triggers/event_types';
import { useT } from '@/lib/i18n/client';

import type { WfEventSubscription } from '../hooks/queries';

import { useAutomationRoots } from '../../hooks/queries';
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
  const { subscriptions } = useEventSubscriptions(workflowRootId);

  const { automationRoots: workflows } = useAutomationRoots(organizationId);

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
        await toggleSubscription.mutateAsync({ subscriptionId, isActive });
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
      await deleteSubscriptionMutation.mutateAsync({
        subscriptionId: deleteTarget._id,
      });
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

  const { formatDate: formatDateLong } = useFormatDate();
  const formatTimestamp = useCallback(
    (timestamp?: number) => {
      if (!timestamp) return t('triggers.common.never');
      return formatDateLong(new Date(timestamp), 'long');
    },
    [t, formatDateLong],
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
            <VStack gap={1}>
              <HStack gap={2}>
                <code className="bg-muted rounded px-2 py-0.5 font-mono text-sm">
                  {eventType}
                </code>
                <Text as="span" variant="caption">
                  {getEventLabel(eventType)}
                </Text>
              </HStack>
              {filterEntries.length > 0 && (
                <HStack gap={1} wrap>
                  {filterEntries.map(([key, value]) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {resolveFilterLabel(eventType, key, String(value))}
                    </Badge>
                  ))}
                </HStack>
              )}
            </VStack>
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
          <Text as="span" variant="muted">
            {formatTimestamp(row.original.lastTriggeredAt)}
          </Text>
        ),
        size: 180,
      },
      {
        id: 'createdBy',
        header: t('triggers.events.columns.createdBy'),
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
          <HStack gap={1} justify="end">
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
          </HStack>
        ),
        size: 100,
      },
    ],
    [t, handleToggle, formatTimestamp, getEventLabel, resolveFilterLabel],
  );

  return (
    <CollapsibleSection
      id="events"
      icon={Zap}
      title={t('triggers.events.title')}
      defaultOpen={(subscriptions?.length ?? 0) > 0}
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
            variant="secondary"
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
