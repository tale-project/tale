'use client';

import type { Collection } from '@tanstack/db';

import { useState, useMemo, useEffect } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { WfEventSubscription } from '@/lib/collections/entities/wf-event-subscriptions';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import {
  EVENT_TYPES,
  EVENT_TYPE_CATEGORIES,
  getFilterFieldsForEventType,
  type EventFilterFieldDef,
} from '@/convex/workflows/triggers/event_types';
import { useT } from '@/lib/i18n/client';

import { useAutomationRootCollection } from '../../hooks/collections';
import { useAutomationRoots } from '../../hooks/queries';
import {
  useCreateEventSubscription,
  useUpdateEventSubscription,
} from '../hooks/mutations';

interface EditingSubscription {
  _id: Id<'wfEventSubscriptions'>;
  eventType: string;
  eventFilter?: Record<string, string>;
}

interface EventCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowRootId: Id<'wfDefinitions'>;
  organizationId: string;
  collection: Collection<WfEventSubscription, string>;
  existingEventTypes: string[];
  editing?: EditingSubscription | null;
}

export function EventCreateDialog({
  open,
  onOpenChange,
  workflowRootId,
  organizationId,
  collection,
  existingEventTypes,
  editing,
}: EventCreateDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const createEventSubscription = useCreateEventSubscription(collection);
  const updateEventSubscription = useUpdateEventSubscription(collection);

  const isEditMode = !!editing;

  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setSelectedEventType(editing.eventType);
        setFilterValues(editing.eventFilter ?? {});
      } else {
        setSelectedEventType('');
        setFilterValues({});
      }
    }
  }, [editing, open]);

  const filterFields = useMemo(
    () => getFilterFieldsForEventType(selectedEventType),
    [selectedEventType],
  );

  const automationRootCollection = useAutomationRootCollection(organizationId);
  const { automationRoots: workflows } = useAutomationRoots(
    automationRootCollection,
  );

  const options = useMemo(() => {
    const result: { value: string; label: string; disabled?: boolean }[] = [];

    for (const [category, categoryMeta] of Object.entries(
      EVENT_TYPE_CATEGORIES,
    )) {
      for (const [type, meta] of Object.entries(EVENT_TYPES)) {
        if (meta.category !== category) continue;
        const alreadySubscribed = existingEventTypes.includes(type);
        result.push({
          value: type,
          label: `${categoryMeta.label} — ${meta.label}`,
          disabled: alreadySubscribed,
        });
      }
    }

    return result;
  }, [existingEventTypes]);

  const selectedMeta = selectedEventType
    ? EVENT_TYPES[selectedEventType]
    : null;

  const handleEventTypeChange = (value: string) => {
    setSelectedEventType(value);
    setFilterValues({});
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues((prev) => {
      if (!value) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventType) return;

    setIsSubmitting(true);
    try {
      const filterPayload =
        Object.keys(filterValues).length > 0 ? filterValues : undefined;

      if (isEditMode && editing) {
        await updateEventSubscription({
          subscriptionId: editing._id,
          eventFilter: filterPayload,
        });
        toast({
          title: t('triggers.events.toast.updated'),
          variant: 'success',
        });
      } else {
        await createEventSubscription({
          organizationId,
          workflowRootId,
          eventType: selectedEventType,
          eventFilter: filterPayload,
        });
        toast({
          title: t('triggers.events.toast.created'),
          variant: 'success',
        });
      }
      resetAndClose();
    } catch {
      toast({
        title: tCommon('errors.generic'),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetAndClose = () => {
    setSelectedEventType('');
    setFilterValues({});
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedEventType('');
      setFilterValues({});
    }
    onOpenChange(isOpen);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={
        isEditMode
          ? t('triggers.events.form.editTitle')
          : t('triggers.events.form.title')
      }
      submitText={
        isEditMode ? tCommon('actions.save') : tCommon('actions.create')
      }
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <Stack gap={4}>
        {isEditMode ? (
          <div>
            <p className="mb-1 text-sm font-medium">
              {t('triggers.events.form.eventType')}
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-muted rounded px-2 py-1 font-mono text-sm">
                {selectedEventType}
              </code>
              <span className="text-muted-foreground text-xs">
                {selectedMeta?.label}
              </span>
            </div>
          </div>
        ) : (
          <Select
            label={t('triggers.events.form.eventType')}
            placeholder={t('triggers.events.form.eventTypePlaceholder')}
            options={options}
            value={selectedEventType}
            onValueChange={handleEventTypeChange}
            required
          />
        )}
        {selectedMeta && !isEditMode && (
          <p className="text-muted-foreground text-sm">
            {selectedMeta.description}
          </p>
        )}
        {filterFields.length > 0 && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">
              {t('triggers.events.form.filtersLabel')}
            </p>
            {filterFields.map((field) => (
              <FilterFieldInput
                key={field.key}
                field={field}
                value={filterValues[field.key] ?? ''}
                onChange={(val) => handleFilterChange(field.key, val)}
                workflows={workflows}
                currentWorkflowRootId={workflowRootId}
              />
            ))}
          </div>
        )}
      </Stack>
    </FormDialog>
  );
}

interface FilterFieldInputProps {
  field: EventFilterFieldDef;
  value: string;
  onChange: (value: string) => void;
  workflows?: { _id: string; name: string }[] | null;
  currentWorkflowRootId: Id<'wfDefinitions'>;
}

const FILTER_NONE = '__none__';

function FilterFieldInput({
  field,
  value,
  onChange,
  workflows,
  currentWorkflowRootId,
}: FilterFieldInputProps) {
  const { t } = useT('automations');

  const handleChange = (val: string) => {
    onChange(val === FILTER_NONE ? '' : val);
  };

  const selectValue = value || FILTER_NONE;

  if (field.inputType === 'workflow-select') {
    const workflowOptions = (workflows ?? [])
      .filter((w) => w._id !== (currentWorkflowRootId as string))
      .map((w) => ({ value: w._id, label: w.name }));

    return (
      <Select
        label={field.label}
        placeholder={t('triggers.events.form.filterAllPlaceholder')}
        options={[
          { value: FILTER_NONE, label: t('triggers.events.form.filterAll') },
          ...workflowOptions,
        ]}
        value={selectValue}
        onValueChange={handleChange}
      />
    );
  }

  if (field.inputType === 'select' && field.options) {
    return (
      <Select
        label={field.label}
        placeholder={t('triggers.events.form.filterAllPlaceholder')}
        options={[
          { value: FILTER_NONE, label: t('triggers.events.form.filterAll') },
          ...field.options,
        ]}
        value={selectValue}
        onValueChange={handleChange}
      />
    );
  }

  if (field.inputType === 'text') {
    return (
      <Input
        label={field.label}
        placeholder={field.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `FilterFieldInput: unsupported inputType "${field.inputType}" for field "${field.key}"`,
    );
  }

  return null;
}
