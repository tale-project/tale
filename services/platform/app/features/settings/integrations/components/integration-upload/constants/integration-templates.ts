// Points to `main` so templates stay current with the shipped app.
// If templates require immutable pinning, replace 'main' with a release tag.
const TEMPLATES_REF = 'main';
const GITHUB_RAW_BASE = `https://raw.githubusercontent.com/tale-project/tale/${TEMPLATES_REF}/examples/integrations`;

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
    description:
      'GitHub REST API integration for repositories, issues, pull requests, and code search',
    authMethod: 'bearer_token',
    type: 'rest_api',
  },
  {
    name: 'slack',
    title: 'Slack',
    description: 'Slack API integration for channels, messages, and users',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'discord',
    title: 'Discord',
    description:
      'Discord Bot API integration for guilds, channels, and messages',
    authMethod: 'bearer_token',
    type: 'rest_api',
  },
  {
    name: 'gmail',
    title: 'Gmail',
    description:
      'Google Gmail API integration for email, labels, threads, and drafts',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'outlook',
    title: 'Microsoft Outlook',
    description:
      'Microsoft Graph API integration for Outlook mail, calendar, and contacts',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'teams',
    title: 'Microsoft Teams',
    description:
      'Microsoft Graph API integration for Teams channels, messages, and chats',
    authMethod: 'oauth2',
    type: 'rest_api',
  },
  {
    name: 'shopify',
    title: 'Shopify',
    description:
      'Shopify Admin API integration for products, customers, and orders',
    authMethod: 'api_key',
    type: 'rest_api',
  },
  {
    name: 'twilio',
    title: 'Twilio',
    description:
      'Twilio API integration for SMS messaging, voice calls, and phone number management',
    authMethod: 'basic_auth',
    type: 'rest_api',
  },
  {
    name: 'circuly',
    title: 'Circuly',
    description:
      'Circuly API integration for products, customers, and subscriptions',
    authMethod: 'basic_auth',
    type: 'rest_api',
  },
  {
    name: 'protel',
    title: 'Protel PMS',
    description:
      'Hotel Property Management System - Direct SQL Access for reservations, guest profiles, rooms, and postings',
    authMethod: 'basic_auth',
    type: 'sql',
  },
];
