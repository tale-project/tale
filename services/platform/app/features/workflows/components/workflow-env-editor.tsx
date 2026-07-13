'use client';

/**
 * Connected env/secret editor for a workflow scope, backed by the `workflowEnv`
 * side-table. `stepSlug` omitted (or '') edits the WORKFLOW-level scope
 * (auto-injected into every sandbox step); a real `stepSlug` edits THAT step.
 * Writes go straight to the table (encrypt-on-save for secrets) — independent of
 * the workflow-file save flow. Renders the shared presentational editor.
 */
import {
  EnvVarListEditor,
  type EnvEditorState,
  type LoadedEnvVar,
} from '@/app/components/env/env-var-list-editor';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export interface WorkflowEnvEditorProps {
  organizationId: string;
  workflowSlug: string;
  /** '' / omitted = workflow-level; a step slug = that step only. */
  stepSlug?: string;
  /** Forwarded to `EnvVarListEditor` — hides the inline Save so the host can
   *  dock Save/Discard in its header cluster (see `useEnvEditorController`). */
  externalSave?: boolean;
  /** Forwarded to `EnvVarListEditor`; required with `externalSave`. */
  onEditorState?: (state: EnvEditorState) => void;
}

export function WorkflowEnvEditor({
  organizationId,
  workflowSlug,
  stepSlug = '',
  externalSave,
  onEditorState,
}: WorkflowEnvEditorProps) {
  const { data, isLoading } = useConvexQuery(
    api.workflows.workflow_env.listWorkflowEnv,
    { organizationId, workflowSlug, stepSlug },
  );
  const { mutateAsync: setVar } = useConvexAction(
    api.workflows.workflow_env_actions.setWorkflowEnvVar,
  );
  const { mutateAsync: deleteVar } = useConvexMutation(
    api.workflows.workflow_env.deleteWorkflowEnvVar,
  );

  return (
    <EnvVarListEditor
      rows={data as LoadedEnvVar[] | undefined}
      isLoading={isLoading}
      externalSave={externalSave}
      onEditorState={onEditorState}
      onSet={async ({ key, value, isSecret }) => {
        await setVar({
          organizationId,
          workflowSlug,
          stepSlug,
          key,
          value,
          isSecret,
        });
      }}
      onDelete={async (key) => {
        await deleteVar({ organizationId, workflowSlug, stepSlug, key });
      }}
    />
  );
}
