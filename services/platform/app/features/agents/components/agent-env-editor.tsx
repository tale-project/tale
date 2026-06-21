'use client';

/**
 * Connected env/secret editor for an agent, backed by the existing per-agent
 * `agentEnv` table (the same store the apps-registry dialog writes). Decrypted +
 * injected at the agent's external-run claim / workflow sandbox step. Renders
 * the shared presentational editor; writes go straight to the table
 * (encrypt-on-save for secrets), independent of the agent-file save flow.
 */
import {
  EnvVarListEditor,
  type LoadedEnvVar,
} from '@/app/components/env/env-var-list-editor';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';

export interface AgentEnvEditorProps {
  organizationId: string;
  agentSlug: string;
}

export function AgentEnvEditor({
  organizationId,
  agentSlug,
}: AgentEnvEditorProps) {
  const { data, isLoading } = useConvexQuery(
    api.agents.agent_env.listAgentEnv,
    {
      organizationId,
      agentSlug,
    },
  );
  const { mutateAsync: setVar } = useConvexAction(
    api.agents.agent_env_actions.setAgentEnvVar,
  );
  const { mutateAsync: deleteVar } = useConvexMutation(
    api.agents.agent_env.deleteAgentEnvVar,
  );

  return (
    <EnvVarListEditor
      rows={data as LoadedEnvVar[] | undefined}
      isLoading={isLoading}
      onSet={async ({ key, value, isSecret }) => {
        await setVar({ organizationId, agentSlug, key, value, isSecret });
      }}
      onDelete={async (key) => {
        await deleteVar({ organizationId, agentSlug, key });
      }}
    />
  );
}
