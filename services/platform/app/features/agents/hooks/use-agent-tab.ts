import type { FunctionArgs } from 'convex/server';

import { toast } from '@/app/hooks/use-toast';
import type { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useSaveAgent } from './mutations';
import { useAgent } from './queries';

type SaveAgentArgs = FunctionArgs<typeof api.agents.actions.saveAgent>;
/** What one editor tab may change — everything but the identity keys. */
export type AgentTabFields = Partial<
  Omit<SaveAgentArgs, 'organizationId' | 'slug' | 'displayName'>
> & { displayName?: string };

/**
 * One editor tab's slice of the agent: the loaded document (shared react-query
 * cache across tabs — one action call per agent) and a `save` that posts ONLY
 * the fields the tab carries. `saveAgent` requires the display name and merges
 * everything else over the on-disk file, so per-tab saves cannot clobber the
 * other tabs' fields.
 */
export function useAgentTab(organizationId: string, slug: string) {
  const { t } = useT('settings');
  const agentQuery = useAgent(organizationId, slug);
  const saveAgent = useSaveAgent();
  const agent = agentQuery.data;

  const save = async (fields: AgentTabFields): Promise<boolean> => {
    if (!agent) return false;
    try {
      await saveAgent.mutateAsync({
        organizationId,
        slug,
        displayName: fields.displayName ?? agent.displayName,
        ...fields,
      });
      toast({ title: t('agents.agentSaved'), variant: 'success' });
      return true;
    } catch (error) {
      console.error('Failed to save agent', error);
      toast({ title: t('agents.agentSaveFailed'), variant: 'destructive' });
      return false;
    }
  };

  return {
    agentQuery,
    agent,
    canEdit: agent?.canEdit ?? false,
    save,
    saving: saveAgent.isPending,
  };
}
