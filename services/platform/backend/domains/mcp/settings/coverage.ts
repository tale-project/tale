/**
 * Where each page of Settings stands over MCP. A page is covered when a
 * settings kind names it among its `areas` (`@tale/shared/schemas/
 * settings-kinds`); every other page is listed here with its reason —
 * either what an agent cannot change there yet, or why the page holds
 * nothing an agent changes. `coverage.test.ts` holds the settings rail to
 * these lists, so a new page of Settings cannot ship without its MCP story.
 */

import type { SettingsArea } from '@tale/shared/schemas/settings-kinds';

/** Pages that hold nothing a settings kind would change. */
export const SETTINGS_NOT_EXPOSED: Readonly<
  Partial<Record<SettingsArea, string>>
> = {
  'api/mcp':
    'It shows the endpoint itself — its address, its tools and how to connect — which no setting changes.',
};

/** Pages no settings kind covers yet, each with what an agent cannot do
 * there. A page leaves this list when a kind names it. */
export const SETTINGS_PLANNED: Readonly<Partial<Record<SettingsArea, string>>> =
  {
    account:
      'No kind changes the display name yet; passwords, passkeys and authenticators stay in Tale.',
    personalization:
      'No kind changes custom instructions or the chat model yet.',
    notifications: 'No kind changes notification preferences yet.',
    usage: "No kind reads a person's own usage and budget status yet.",
    organization:
      'No kind changes the organization profile yet; deleting it stays in Tale.',
    teams: 'No kind changes teams or their members yet.',
    members:
      "No kind changes members' roles, removals or invitations yet; transferring ownership stays in Tale.",
    connectors:
      'No kind changes connector credentials or sign-in apps yet; their secrets are entered in Tale.',
    skills: 'No kind changes skills or who may use them yet.',
    'governance/competences': 'No kind grants or revokes competences yet.',
    'governance/logs': 'No kind reads the audit log yet.',
    'governance/legal-hold':
      'No kind changes legal matters, holds or release requests yet.',
    'governance/data-subject-requests':
      'No kind files erasure requests or changes the request policy yet.',
    'governance/trash': 'No kind restores deleted items yet.',
    'metrics/usage': 'No kind reads the usage figures yet.',
    'metrics/feedback': 'No kind reads the feedback figures yet.',
    'metrics/chat-health': 'No kind reads the chat health figures yet.',
    'metrics/external-turns': 'No kind reads the external turn figures yet.',
    'metrics/automations': 'No kind reads the automation figures yet.',
    'metrics/projects': 'No kind reads the project figures yet.',
    'api/rest':
      'No kind revokes API keys yet; a key is created in Tale, where it is shown once.',
    'api/webdav':
      'No kind revokes WebDAV app passwords yet; one is created in Tale, where it is shown once.',
  };
