'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Select } from '@/app/components/ui/forms/select';
import { Stack } from '@/app/components/ui/layout/layout';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { Id } from '@/convex/_generated/dataModel';
import { api } from '@/convex/_generated/api';
import {
  useCreateEventSubscription,
  useUpdateEventSubscription,
} from '../hooks/use-trigger-mutations';
import {
  EVENT_TYPES,
  EVENT_TYPE_CATEGORIES,
  getFilterFieldsForEventType,
  type EventType,
  type EventFilterFieldDef,
} from '@/convex/workflows/triggers/event_types';

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
  existingEventTypes: string[];
  editing?: EditingSubscription | null;
}

export function EventCreateDialog({
  open,
  onOpenChange,
  workflowRootId,
  organizationId,
  existingEventTypes,
  editing,
}: EventCreateDialogProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const createEventSubscription = useCreateEventSubscription();
  const updateEventSubscription = useUpdateEventSubscription();

  const isEditMode = !!editing;

  const [selectedEventType, setSelectedEventType] = useState<string>('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (editing && open) {
      setSelectedEventType(editing.eventType);
      setFilterValues(editing.eventFilter ?? {});
    }
  }, [editing, open]);

  const filterFields = useMemo(
    () => getFilterFieldsForEventType(selectedEventType),
    [selectedEventType],
  );

  const hasWorkflowSelect = filterFields.some((f) => f.inputType === 'workflow-select');

  const workflows = useQuery(
    api.wf_definitions.queries.listAutomationRoots,
    hasWorkflowSelect ? { organizationId } : 'skip',
  );

  const options = useMemo(() => {
    const result: { value: string; label: string; disabled?: boolean }[] = [];

    for (const [category, categoryMeta] of Object.entries(EVENT_TYPE_CATEGORIES)) {
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
    ? EVENT_TYPES[selectedEventType as EventType]
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
      const filterPayload = Object.keys(filterValues).length > 0 ? filterValues : undefined;

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
      title={isEditMode ? t('triggers.events.form.editTitle') : t('triggers.events.form.title')}
      submitText={isEditMode ? tCommon('actions.save') : tCommon('actions.create')}
      submittingText={tCommon('actions.loading')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <Stack gap={4}>
        {isEditMode ? (
          <div>
            <p className="text-sm font-medium mb-1">
              {t('triggers.events.form.eventType')}
            </p>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                {selectedEventType}
              </code>
              <span className="text-xs text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
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

  return null;
}
