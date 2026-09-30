import type { AppAbility } from '@/lib/permissions/ability';

/**
 * Whether someone may use Automations at all. It is a builder's section:
 * only Owners, Admins and Developers — the server's author gate, which the
 * client reads as the `developerSettings` ability — get the rail and tab-bar
 * entry, a project's Automations tab, the automation pages and the links
 * into them. Members and Editors get none of it; tasks and the Inbox still
 * read automations and runs on their behalf, so the server's reads stay
 * open to them.
 */
export function canUseAutomations(ability: AppAbility): boolean {
  return ability.can('read', 'developerSettings');
}
