'use client';

import { Button } from '@tale/ui/button';
import { useAction } from 'convex/react';
import { Play } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Select } from '@/app/components/ui/forms/select';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAutomations } from '../../automations/hooks/queries';

/**
 * The task's Start affordance: run one of the project's DEPLOYED automations
 * with this task as its subject — the tasks-board successor of the retired
 * desk's Start button, wired to the same `startTaskWorkflow` contract (the
 * workflow owns the task's status from here; a duplicate live run is refused
 * with the in-flight run id). Renders nothing when the project has no
 * deployed automation.
 */
export function TaskStartAutomation({
  organizationId,
  projectId,
  taskId,
  disabled,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  taskId: Id<'tasks'>;
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const automationsQuery = useAutomations(organizationId, projectId);
  const startWorkflow = useAction(api.tasks.public_actions.startTaskWorkflow);
  const [pending, setPending] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const deployed = useMemo(
    () =>
      (automationsQuery.data ?? []).filter(
        (automation) =>
          'deployedVersion' in automation &&
          automation.deployedVersion !== undefined,
      ),
    [automationsQuery.data],
  );

  if (deployed.length === 0) return null;

  const slug = picked ?? deployed[0]?.name;
  if (slug === undefined) return null;

  const start = async () => {
    setPending(true);
    try {
      const result = await startWorkflow({
        organizationId,
        taskId,
        workflowSlug: slug,
      });
      if (result.started) {
        toast({ title: t('startAutomation.started'), variant: 'success' });
      } else if (result.reason === 'already_running') {
        toast({ title: t('startAutomation.alreadyRunning') });
      } else {
        toast({
          title: t('startAutomation.notStarted'),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('tasks: start automation failed', error);
      toast({
        title: t('startAutomation.notStarted'),
        variant: 'destructive',
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {deployed.length > 1 && (
        <Select
          label={t('startAutomation.pick')}
          value={slug}
          onValueChange={(next) => setPicked(next)}
          options={deployed.map((automation) => ({
            value: automation.name,
            label: automation.name,
          }))}
          disabled={disabled || pending}
        />
      )}
      <Button
        variant="secondary"
        size="sm"
        icon={Play}
        isLoading={pending}
        disabled={disabled}
        onClick={() => void start()}
      >
        {deployed.length === 1
          ? t('startAutomation.runNamed', { automation: slug })
          : t('startAutomation.run')}
      </Button>
    </div>
  );
}
