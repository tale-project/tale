import { useMyModelApiAccess } from '@/app/features/settings/governance/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';

/**
 * Who may open which API settings tab. Owners, admins and developers — the
 * role's developer settings — see every tab. A member of any other role who
 * may call the model endpoints (a live `tale:models.api` grant) sees the two
 * tabs that serve them: REST, where they create their personal API key, and
 * Models, where they read how to point a tool at the endpoints.
 */
export interface ApiSettingsAccess {
  /** Owner, admin or developer by role: every API tab. */
  developer: boolean;
  /** May call the model endpoints — by role or through the grant. */
  modelApi: boolean;
  /** The role or, for a member who needs it, the grant is still loading. */
  loading: boolean;
}

export function useApiSettingsAccess(
  organizationId: string,
): ApiSettingsAccess {
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const developer = ability.can('read', 'developerSettings');
  const standing = useMyModelApiAccess(organizationId);
  return {
    developer,
    modelApi: developer || standing.data?.allowed === true,
    loading: abilityLoading || (!developer && standing.isLoading),
  };
}
