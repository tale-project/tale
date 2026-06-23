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
import { configKeys } from '@/app/hooks/config-query-keys';
import { useActionQuery } from '@/app/hooks/use-action-query';
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
  // The org's token sources drive the per-row binding dropdown (a row can draw
  // its value from a rotating broker pool instead of a literal secret).
  const { data: tokenSources } = useActionQuery(
    configKeys.list('token-sources', organizationId),
    api.token_sources.file_actions.listTokenSources,
    { organizationId },
    { enabled: !!organizationId },
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
      tokenSources={tokenSources}
      onSet={async ({ key, value, isSecret, tokenSourceSlug }) => {
        await setVar({
          organizationId,
          agentSlug,
          key,
          value,
          isSecret,
          ...(tokenSourceSlug !== undefined && { tokenSourceSlug }),
        });
      }}
      onDelete={async (key) => {
        await deleteVar({ organizationId, agentSlug, key });
      }}
    />
  );
}
