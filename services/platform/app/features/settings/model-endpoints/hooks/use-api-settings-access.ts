import {
  useMyApiKeyAccess,
  useMyModelApiAccess,
} from '@/app/features/settings/governance/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';

/**
 * Who may open which API settings tab. Owners, admins and developers — the
 * role's developer settings — see every tab. A member of any other role who
 * may create a personal API key (a live grant of a competence that is used
 * with one, the rule the key's create endpoint holds them to) sees REST,
 * where the key is made; so does one who holds a key after that right
 * lapsed, to see and revoke it. One who may call the model endpoints (a
 * live `tale:models.api` grant) sees Models too, where a tool is set up.
 */
export interface ApiSettingsAccess {
  /** Owner, admin or developer by role: every API tab. */
  developer: boolean;
  /** Opens the REST tab: may create a personal API key, or holds one. */
  apiKeys: boolean;
  /** May create a personal API key — by role or through a grant. */
  createApiKeys: boolean;
  /** May call the model endpoints — by role or through the grant. */
  modelApi: boolean;
  /** The role or, for a member who needs them, the grants are still loading. */
  loading: boolean;
}

export function useApiSettingsAccess(
  organizationId: string,
): ApiSettingsAccess {
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const developer = ability.can('read', 'developerSettings');
  const standing = useMyModelApiAccess(organizationId);
  const keys = useMyApiKeyAccess(organizationId);
  const modelApi = developer || standing.data?.allowed === true;
  // Calling the model endpoints takes a key, so their grant is one of the
  // competences that let a member make one.
  const createApiKeys = modelApi || keys.data?.mayCreate === true;
  return {
    developer,
    apiKeys: createApiKeys || keys.data?.holdsKeys === true,
    createApiKeys,
    modelApi,
    loading:
      abilityLoading || (!developer && (standing.isLoading || keys.isLoading)),
  };
}
