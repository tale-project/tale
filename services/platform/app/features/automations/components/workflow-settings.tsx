'use client';

import { Button } from '@tale/ui/button';
import { KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  ProjectBindingsSection,
  type ProjectBindingsController,
} from './project-bindings-section';
import { TriggerEditor, type TriggerEditorController } from './trigger-editor';

/**
 * Trigger + project bindings as one inspector surface with a single Save.
 * Each section still owns its own store write; Save fires whichever are dirty.
 *
 * Fills the workbench column height and pins the actions to the bottom so the
 * panel matches the canvas beside it without a dead empty band under the form.
 */
export function WorkflowSettings({
  organizationId,
  name,
  canEdit,
}: {
  organizationId: string;
  name: string;
  canEdit: boolean;
}) {
  const { t } = useT('automations');
  const [trigger, setTrigger] = useState<TriggerEditorController | null>(null);
  const [projects, setProjects] = useState<ProjectBindingsController | null>(
    null,
  );

  const onTriggerController = useCallback(
    (next: TriggerEditorController | null) => {
      setTrigger(next);
    },
    [],
  );
  const onProjectsController = useCallback(
    (next: ProjectBindingsController | null) => {
      setProjects(next);
    },
    [],
  );

  const dirty = (trigger?.dirty ?? false) || (projects?.dirty ?? false);
  const pending = (trigger?.pending ?? false) || (projects?.pending ?? false);
  const blocked = trigger?.blocked ?? false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* px-px: resting field rings are box-shadows; overflow clips them flush
          to the scrollport edges and the select triggers look borderless. */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-px">
        <TriggerEditor
          organizationId={organizationId}
          name={name}
          canEdit={canEdit}
          showActions={false}
          onControllerChange={onTriggerController}
        />
        <ProjectBindingsSection
          organizationId={organizationId}
          name={name}
          canEdit={canEdit}
          showActions={false}
          onControllerChange={onProjectsController}
        />
      </div>
      {canEdit && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 pt-3">
          <Button
            size="sm"
            isLoading={pending}
            disabled={!dirty || blocked}
            disabledReason={
              blocked ? t('trigger.cronInvalid') : t('workflow.nothingToSave')
            }
            onClick={() => {
              if (trigger?.dirty === true && !trigger.blocked) {
                trigger.save();
              }
              if (projects?.dirty === true) {
                projects.save();
              }
            }}
          >
            {t('workflow.save')}
          </Button>
          {trigger?.canRotate === true && (
            <Button
              size="sm"
              variant="secondary"
              icon={KeyRound}
              isLoading={trigger.pending}
              onClick={() => {
                trigger.rotate();
              }}
            >
              {t('trigger.rotate')}
            </Button>
          )}
          {trigger?.canRemove === true && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              isLoading={trigger.removePending}
              onClick={() => {
                trigger.requestRemove();
              }}
            >
              {t('trigger.remove')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
