'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useCreateTask } from '../hooks/mutations';
import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_ORDER,
  type TaskPriority,
  type TaskStatus,
} from '../lib/display';
import { TaskPriorityIcon } from './task-priority-icon';

// Status and priority always carry a value, but the user never has to choose:
// a new task defaults to the Backlog column with no priority. Both fields can
// be changed up front, yet creating with just a title is the fast path.
const DEFAULT_STATUS: TaskStatus = 'backlog';
const NO_PRIORITY = 'none';

type PriorityValue = TaskPriority | typeof NO_PRIORITY;

interface CreateTaskFormData {
  title: string;
  description: string;
  status: TaskStatus;
  priority: PriorityValue;
}

export function CreateTaskDialog({
  organizationId,
  projectId,
  open,
  onOpenChange,
  defaultStatus = DEFAULT_STATUS,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultStatus?: TaskStatus;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const createTask = useCreateTask();

  const statusOptions = useMemo(
    () => TASK_STATUS_ORDER.map((s) => ({ value: s, label: t(`status.${s}`) })),
    [t],
  );
  const priorityOptions = useMemo(
    () => [
      { value: NO_PRIORITY, label: t('priority.none') },
      ...TASK_PRIORITY_ORDER.map((p) => ({
        value: p,
        label: t(`priority.${p}`),
        icon: <TaskPriorityIcon priority={p} />,
      })),
    ],
    [t],
  );

  const formSchema = useMemo(
    () =>
      z.object({
        title: z.string().trim().min(1).max(200),
        description: z.string().max(20_000),
        status: z.enum([
          'backlog',
          'todo',
          'in_progress',
          'in_review',
          'done',
          'cancelled',
        ]),
        priority: z.enum([NO_PRIORITY, 'p0', 'p1', 'p2', 'p3']),
      }),
    [],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    setValue,
    watch,
  } = useForm<CreateTaskFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      status: defaultStatus,
      priority: NO_PRIORITY,
    },
  });

  const status = watch('status');
  const priority = watch('priority');

  const onSubmit = async (data: CreateTaskFormData) => {
    try {
      await createTask.mutateAsync({
        organizationId,
        projectId,
        title: data.title.trim(),
        description: data.description.trim() || undefined,
        status: data.status,
        priority: data.priority === NO_PRIORITY ? undefined : data.priority,
      });
      toast({ title: t('actions.create'), variant: 'success' });
      reset();
      onOpenChange(false);
    } catch (error) {
      console.error('Create task error:', error);
      toast({ title: tCommon('errors.generic'), variant: 'destructive' });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('actions.create')}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
    >
      <Input
        id="task-title"
        label={t('fields.title')}
        {...register('title')}
        disabled={isSubmitting}
        errorMessage={errors.title?.message}
        required
      />
      <Textarea
        id="task-description"
        label={t('fields.description')}
        rows={4}
        {...register('description')}
        disabled={isSubmitting}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          id="task-status"
          label={t('fields.status')}
          value={status}
          onValueChange={(value: string) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options derived from TASK_STATUS_ORDER
            setValue('status', value as TaskStatus, { shouldDirty: true })
          }
          disabled={isSubmitting}
          options={statusOptions}
        />
        <Select
          id="task-priority"
          label={t('fields.priority')}
          value={priority}
          onValueChange={(value: string) =>
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- options derived from TASK_PRIORITY_ORDER + the no-priority sentinel
            setValue('priority', value as PriorityValue, {
              shouldDirty: true,
            })
          }
          disabled={isSubmitting}
          options={priorityOptions}
        />
      </div>
    </FormDialog>
  );
}
