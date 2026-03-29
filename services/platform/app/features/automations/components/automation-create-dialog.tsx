'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import { useMemo, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useSaveWorkflow } from '../hooks/file-mutations';
import { WorkflowTemplateGrid } from './workflow-template-grid';

type FormData = {
  name: string;
  description?: string;
};

type TabValue = 'blank' | 'template';

const TAB_VALUES = new Set<string>(['blank', 'template']);

function isTabValue(value: string): value is TabValue {
  return TAB_VALUES.has(value);
}

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  /** Pre-filter templates to a specific integration */
  integrationName?: string;
  /** Start on the template tab instead of blank */
  defaultTab?: TabValue;
}

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function BlankTabContent({
  organizationId,
  onOpenChange,
}: {
  organizationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const { mutateAsync: saveWorkflow } = useSaveWorkflow();

  const formSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, tCommon('validation.required', { field: t('form.name') })),
        description: z.string().optional(),
      }),
    [t, tCommon],
  );

  const {
    register,
    handleSubmit,
    setError,
    formState: { isSubmitting, errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit = useCallback(
    async (data: FormData) => {
      const workflowSlug = nameToSlug(data.name);
      if (!workflowSlug) {
        setError('name', { message: t('validation.duplicateName') });
        return;
      }

      try {
        await saveWorkflow({
          orgSlug: 'default',
          workflowSlug,
          config: {
            name: data.name,
            description: data.description ?? '',
            installed: true,
            enabled: false,
            steps: [],
          },
        });

        window.dispatchEvent(new Event('workflow-updated'));
        toast({
          title: t('toast.created'),
          variant: 'success',
        });
        void navigate({
          to: '/dashboard/$id/automations/$amId',
          params: { id: organizationId, amId: slugToUrlParam(workflowSlug) },
          search: { panel: 'ai-chat' },
        });
      } catch (error) {
        if (
          error instanceof ConvexError &&
          error.data?.code === 'DUPLICATE_NAME'
        ) {
          setError('name', { message: t('validation.duplicateName') });
          return;
        }
        toast({
          title: t('toast.createFailed'),
          variant: 'destructive',
        });
      }
    },
    [saveWorkflow, organizationId, t, navigate, setError],
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Stack>
        <Input
          id="name"
          label={t('configuration.name')}
          {...register('name')}
          placeholder={t('createDialog.namePlaceholder')}
          errorMessage={errors.name?.message}
        />
        <Textarea
          id="description"
          label={t('configuration.description')}
          {...register('description')}
          placeholder={t('createDialog.descriptionPlaceholder')}
          rows={3}
        />
      </Stack>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
          disabled={isSubmitting}
        >
          {tCommon('actions.cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? t('createDialog.creating')
            : t('createDialog.continue')}
        </Button>
      </div>
    </form>
  );
}

function TemplateTabContent({
  organizationId,
  integrationName,
  onOpenChange,
}: {
  organizationId: string;
  integrationName?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();

  const handleTemplateInstalled = useCallback(
    (slug: string) => {
      toast({
        title: t('toast.created'),
        variant: 'success',
      });
      const amId = slugToUrlParam(slug);
      void navigate({
        to: '/dashboard/$id/automations/$amId',
        params: { id: organizationId, amId },
      });
    },
    [organizationId, t, navigate],
  );

  return (
    <Stack gap={4}>
      <WorkflowTemplateGrid
        integrationName={integrationName}
        onTemplateInstalled={handleTemplateInstalled}
      />
      <div className="flex justify-end pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOpenChange(false)}
        >
          {tCommon('actions.cancel')}
        </Button>
      </div>
    </Stack>
  );
}

function CreateAutomationDialogContent({
  open,
  onOpenChange,
  organizationId,
  integrationName,
  defaultTab = 'blank',
}: CreateAutomationDialogProps) {
  const { t } = useT('automations');
  const [activeTab, setActiveTab] = useState<TabValue>(defaultTab);

  const handleTabChange = useCallback((value: string) => {
    if (isTabValue(value)) {
      setActiveTab(value);
    }
  }, []);

  const tabItems = useMemo(
    () => [
      {
        value: 'blank',
        label: t('createDialog.tabBlank'),
        content: (
          <BlankTabContent
            organizationId={organizationId}
            onOpenChange={onOpenChange}
          />
        ),
      },
      {
        value: 'template',
        label: t('createDialog.tabTemplate'),
        content: (
          <TemplateTabContent
            organizationId={organizationId}
            integrationName={integrationName}
            onOpenChange={onOpenChange}
          />
        ),
      },
    ],
    [t, organizationId, onOpenChange, integrationName],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('createDialog.title')}
      size="md"
    >
      <Tabs
        items={tabItems}
        value={activeTab}
        onValueChange={handleTabChange}
        listClassName="w-full [&>button]:flex-1"
      />
    </Dialog>
  );
}

export function CreateAutomationDialog(props: CreateAutomationDialogProps) {
  if (!props.open) return null;
  return <CreateAutomationDialogContent {...props} />;
}
