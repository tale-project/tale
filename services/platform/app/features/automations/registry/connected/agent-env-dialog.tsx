'use client';

/**
 * Inline editor for an agent's env + secrets, on the automation page (no
 * navigation). Backed by the per-agent `agentEnv` table — plain vars, encrypted
 * secrets, and token-source bindings — via the shared `EnvVarListEditor` (same
 * surface as the agent Environment tab).
 */
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { useRef, useState } from 'react';

import {
  EnvVarListEditor,
  type EnvEditorState,
  type LoadedEnvVar,
  type TokenSourceOption,
} from '@/app/components/env/env-var-list-editor';
import { useRegisterDirtySource } from '@/app/components/ui/editor';
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useBoundAction } from '../../hooks/use-bound-action';
import { useBoundQuery } from '../../hooks/use-bound-query';
import { useAutomationRuntime } from '../../runtime/automation-runtime';

export interface AgentEnvDialogProps {
  agentSlug: string | null;
  displayName: string;
  onClose: () => void;
}

/** The editor body — mounted only while the dialog is open, so the bound query
 *  subscribes only then. */
function EnvEditor({
  agentSlug,
  displayName,
  onClose,
}: {
  agentSlug: string;
  displayName: string;
  onClose: () => void;
}) {
  const { t } = useT('automations');
  const { organizationId } = useAutomationRuntime();
  const { data, isLoading } = useBoundQuery('agents/agent_env:listAgentEnv', {
    organizationId: '$orgId',
    agentSlug,
  });
  const { data: tokenSources } = useActionQuery(
    configKeys.list('token-sources', organizationId),
    api.token_sources.file_actions.listTokenSources,
    { organizationId },
    { enabled: !!organizationId },
  );
  const set = useBoundAction(
    'agents/agent_env_actions:setAgentEnvVar',
    'action',
  );
  const del = useBoundAction('agents/agent_env:deleteAgentEnvVar', 'mutation');
  const setRef = useRef(set);
  setRef.current = set;
  const delRef = useRef(del);
  delRef.current = del;

  const [editorState, setEditorState] = useState<EnvEditorState | null>(null);
  // Pending inline edits join the page-level DirtyBlockerProvider so a
  // navigation away from the automation page prompts instead of silently
  // dropping them (#2572). `EnvEditor` mounts only while the dialog is open,
  // so unmount (close) unregisters the source.
  useRegisterDirtySource(editorState?.isDirty ?? false);

  const onSave = async (): Promise<void> => {
    if (editorState === null) return;
    try {
      await editorState.save();
      onClose();
    } catch (err) {
      // EnvVarListEditor rethrows in externalSave mode so the host owns the toast.
      toast({
        title: t('agents.env.saveError'),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <ResponsiveDialogTitle>
          {t('agents.env.title', { name: displayName })}
        </ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          {t('agents.env.description')}
        </ResponsiveDialogDescription>
      </VStack>

      <EnvVarListEditor
        rows={data as LoadedEnvVar[] | undefined}
        isLoading={isLoading}
        externalSave
        onEditorState={setEditorState}
        tokenSources={(tokenSources ?? []) as TokenSourceOption[]}
        onSet={async ({ key, value, isSecret, tokenSourceSlug }) => {
          await setRef.current.dispatch({
            organizationId: '$orgId',
            agentSlug,
            key,
            value,
            isSecret,
            ...(tokenSourceSlug !== undefined && { tokenSourceSlug }),
          });
        }}
        onDelete={async (key) => {
          await delRef.current.dispatch({
            organizationId: '$orgId',
            agentSlug,
            key,
          });
        }}
      />

      <HStack gap={2} className="justify-end">
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={editorState?.isSaving ?? false}
        >
          {t('agents.env.cancel')}
        </Button>
        <Button
          onClick={() => void onSave()}
          disabled={
            editorState === null || editorState.isSaving || !editorState.isDirty
          }
        >
          {editorState?.isSaving
            ? t('agents.env.saving')
            : t('agents.env.save')}
        </Button>
      </HStack>
    </VStack>
  );
}

export function AgentEnvDialog({
  agentSlug,
  displayName,
  onClose,
}: AgentEnvDialogProps) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog
      open={agentSlug !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ResponsiveDialogContent className="max-w-xl">
        {agentSlug === null ? (
          // Title is required for a11y even in the (unrendered) closed state.
          <ResponsiveDialogTitle className="sr-only">
            {t('agents.env.title', { name: '' })}
          </ResponsiveDialogTitle>
        ) : (
          <EnvEditor
            key={agentSlug}
            agentSlug={agentSlug}
            displayName={displayName}
            onClose={onClose}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
