// Points to `main` so templates stay current with the shipped app.
// If templates require immutable pinning, replace 'main' with a release tag.
const TEMPLATES_REF = 'main';
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/tale-project/tale/${TEMPLATES_REF}/examples/default/integrations`;

export interface IntegrationTemplate {
  name: string;
  title: string;
  description: string;
  authMethod: 'api_key' | 'bearer_token' | 'basic_auth' | 'oauth2';
  type: 'rest_api' | 'sql';
}

export function getTemplateIconUrl(templateName: string) {
  return `${GITHUB_RAW_BASE}/${templateName}/icon.svg`;
}

export function getTemplateFileUrl(templateName: string, fileName: string) {
  return `${GITHUB_RAW_BASE}/${templateName}/${fileName}`;
}

export const INTEGRATION_TEMPLATES: IntegrationTemplate[] = [
  {
    name: 'github',
    title: 'GitHub',
    description: 'Manage repositories, issues, and pull requests on GitHub.',
    authMethod: 'bearer_token',
    type: 'rest_api',
  },
  {
    name: 'slack',
    title: 'Slack',
    description: 'Send messages and interact with channels in Slack.',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'discord',
    title: 'Discord',
    description: 'Post messages and manage channels in your Discord server.',
    authMethod: 'bearer_token',
    type: 'rest_api',
  },
  {
    name: 'gmail',
    title: 'Gmail',
    description: 'Read, send, and organize email in Gmail.',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'outlook',
    title: 'Microsoft Outlook',
    description: 'Manage Outlook mail, calendar, and contacts.',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'teams',
    title: 'Microsoft Teams',
    description: 'Send messages and manage channels in Microsoft Teams.',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'shopify',
    title: 'Shopify',
    description:
      'Sync products, customers, and orders from your Shopify store.',
    authMethod: 'api_key',
    type: 'rest_api',
  },
  {
    name: 'twilio',
    title: 'Twilio',
    description: 'Send SMS and make voice calls with Twilio.',
    authMethod: 'basic_auth',
    type: 'rest_api',
  },
];
