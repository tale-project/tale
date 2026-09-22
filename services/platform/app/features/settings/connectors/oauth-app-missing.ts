/**
 * Which explainer a consent step shows when the connector has no OAuth app
 * to consent against.
 *
 * Most connectors' apps are registered per organization (the OAuth apps card
 * on the same page), so an admin is pointed at that card and a member at an
 * admin. A deployment-only app — Slack, whose inbound Events signature check
 * runs before any organization is known — has no such card: pointing anyone
 * at "the OAuth apps section below" sends them to a row that does not exist.
 * The door says which case a slug is (`oauthApp.orgConfigurable`).
 */
export type OauthAppMissingExplainer = 'deployment' | 'admin' | 'member';

export function oauthAppMissingExplainer(input: {
  orgConfigurable: boolean;
  canManageOrgSettings: boolean;
}): OauthAppMissingExplainer {
  if (!input.orgConfigurable) return 'deployment';
  return input.canManageOrgSettings ? 'admin' : 'member';
}
