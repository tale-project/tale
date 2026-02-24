import { defineAbilityFor } from './ability';

type SettingsRoute =
  | '/dashboard/$id/settings/organization'
  | '/dashboard/$id/settings/integrations'
  | '/dashboard/$id/settings/account';

export function getDefaultSettingsRoute(role: string | null): SettingsRoute {
  const ability = defineAbilityFor(role);

  if (ability.can('read', 'orgSettings')) {
    return '/dashboard/$id/settings/organization';
  }

  if (ability.can('read', 'developerSettings')) {
    return '/dashboard/$id/settings/integrations';
  }

  return '/dashboard/$id/settings/account';
}
