import { afterEach, describe, expect, it } from 'vitest';

import { runAdapted } from '@/app/lib/backend/adapters';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import { SHIPPED_LOCALES } from '@/tests/utils/lapsed-session';

import { connectorFailureDetail, mapConnectorError } from './connector-error';
import type { ConnectorSummary } from './hooks/backend';

/** What an adapted call rejects with for a door's non-2xx answer. */
function answered(status: number, body: unknown): Promise<unknown> {
  return runAdapted(() =>
    Promise.reject(backendApiErrorFromBody(status, body)),
  ).catch((error: unknown) => error);
}

const settings = (key: string, values?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'settings', ...values });

const disjunction = (items: string[]) =>
  new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(items);

function connector(
  slug: string,
  displayName: string,
  rest: Partial<ConnectorSummary> = {},
): { summary: ConnectorSummary } {
  return {
    summary: {
      slug,
      displayName,
      description: `${displayName}.`,
      tags: [],
      endpointMode: 'fixed',
      authMethods: ['bearer'],
      configFields: [],
      actionCount: 1,
      ...rest,
    },
  };
}

const github = connector('github', 'GitHub');
const forgejo = connector('forgejo', 'Forgejo', {
  endpointMode: 'per-credential',
});
const imapSmtp = connector('imap-smtp', 'IMAP / SMTP Mailbox', {
  authMethods: ['basic'],
  configFields: [
    {
      key: 'imapHost',
      label: 'IMAP server',
      type: 'string',
      required: true,
      i18n: { de: { label: 'IMAP-Server' }, fr: { label: 'Serveur IMAP' } },
    },
    {
      key: 'imapPort',
      label: 'IMAP port',
      type: 'number',
      required: false,
      integer: true,
      min: 1,
      max: 65535,
    },
    {
      key: 'security',
      label: 'Connection security',
      type: 'string',
      required: false,
      enum: ['tls', 'starttls'],
      optionLabels: { tls: 'Implicit TLS', starttls: 'STARTTLS' },
      i18n: {
        de: {
          label: 'Verbindungssicherheit',
          optionLabels: { tls: 'Implizites TLS' },
        },
      },
    },
  ],
});

/** The declared label a field shows in the reader's language. */
const declared = (labels: Record<string, string>) =>
  labels[i18n.language] ?? labels['en'] ?? '';

interface Refusal {
  name: string;
  status: number;
  /** The door's answer, its English sentence as the door words it. */
  body: Record<string, unknown>;
  vendor?: { summary: ConnectorSummary };
  /** What the surface shows, in the reader's language. */
  shows: () => string;
}

// #5222: each answered an English sentence that interpolates a connector, a
// field, a sign-in method or a limit, and the connectors surface showed it
// as written in every locale.
const REFUSALS: Refusal[] = [
  {
    name: 'a connector the deployment no longer offers',
    status: 400,
    body: {
      error: 'CONNECTOR_UNKNOWN',
      message:
        'Unknown connector "gitlab" — available connectors: github, imap-smtp.',
      data: { connector: 'gitlab' },
    },
    shows: () =>
      settings('connectors.errors.connectorUnknown', { connector: 'gitlab' }),
  },
  {
    name: 'a sign-in method the connector does not accept',
    status: 400,
    body: {
      error: 'AUTH_METHOD_NOT_SUPPORTED',
      message:
        'Connector "github" does not accept api-key credentials — it accepts: bearer, oauth2.',
      data: {
        connector: 'github',
        authMethod: 'api-key',
        accepted: ['bearer', 'oauth2'],
      },
    },
    vendor: github,
    shows: () =>
      settings('connectors.errors.authMethodNotSupported', {
        connector: 'GitHub',
        method: settings('connectors.authMethod.apiKey'),
        accepted: disjunction([
          settings('connectors.authMethod.bearer'),
          settings('connectors.authMethod.oauth2'),
        ]),
      }),
  },
  {
    name: 'a missing instance URL',
    status: 400,
    body: {
      error: 'CREDENTIAL_ENDPOINT_REQUIRED',
      message:
        'Connector "forgejo" uses one endpoint per credential — enter the instance URL.',
      data: { connector: 'forgejo' },
    },
    vendor: forgejo,
    shows: () =>
      settings('connectors.errors.endpointRequired', { connector: 'Forgejo' }),
  },
  {
    name: 'an instance URL with a path',
    status: 400,
    body: {
      error: 'CREDENTIAL_ENDPOINT_INVALID',
      message:
        'Enter the instance URL without a path, query, or fragment (https://git.example.com).',
      data: {
        connector: 'forgejo',
        reason: 'notOrigin',
        origin: 'https://git.example.com',
      },
    },
    vendor: forgejo,
    shows: () =>
      settings('connectors.errors.endpointNotOrigin', {
        origin: 'https://git.example.com',
      }),
  },
  {
    name: 'a missing required setting',
    status: 400,
    body: {
      error: 'CREDENTIAL_CONFIG_REQUIRED',
      message: 'Connector "imap-smtp" needs "IMAP server".',
      data: { connector: 'imap-smtp', field: 'imapHost', reason: 'required' },
    },
    vendor: imapSmtp,
    shows: () =>
      settings('connectors.errors.configRequired', {
        field: declared({
          en: 'IMAP server',
          de: 'IMAP-Server',
          fr: 'Serveur IMAP',
        }),
      }),
  },
  {
    name: 'a port out of range',
    status: 400,
    body: {
      error: 'CREDENTIAL_CONFIG_INVALID',
      message: '"IMAP port" must be a number between 1 and 65535.',
      data: {
        connector: 'imap-smtp',
        field: 'imapPort',
        reason: 'number',
        min: 1,
        max: 65535,
      },
    },
    vendor: imapSmtp,
    shows: () =>
      settings('connectors.errors.configNumberRange', {
        field: 'IMAP port',
        min: '1',
        max: '65535',
      }),
  },
  {
    name: 'a value that is none of the options',
    status: 400,
    body: {
      error: 'CREDENTIAL_CONFIG_INVALID',
      message: '"Connection security" must be one of: tls, starttls.',
      data: {
        connector: 'imap-smtp',
        field: 'security',
        reason: 'option',
        options: ['tls', 'starttls'],
      },
    },
    vendor: imapSmtp,
    shows: () =>
      settings('connectors.errors.configOption', {
        field: declared({
          en: 'Connection security',
          de: 'Verbindungssicherheit',
        }),
        options: disjunction([
          declared({ en: 'Implicit TLS', de: 'Implizites TLS' }),
          'STARTTLS',
        ]),
      }),
  },
  {
    name: 'a password too long',
    status: 400,
    body: {
      error: 'CREDENTIAL_SECRET_INVALID',
      message: 'Password must be 1..8192 characters.',
      data: {
        field: 'password',
        authMethod: 'basic',
        reason: 'length',
        max: 8192,
      },
    },
    vendor: imapSmtp,
    shows: () =>
      settings('connectors.errors.secretLength', {
        field: settings('connectors.dialog.password'),
        max: '8192',
      }),
  },
  {
    name: 'an OAuth app write by a member',
    status: 403,
    body: { error: 'Only admins can configure OAuth apps.', code: 'FORBIDDEN' },
    shows: () => settings('credentials.errors.forbidden'),
  },
  {
    name: 'a credential write without the developer capability',
    status: 403,
    body: {
      error: 'The developer capability is required here.',
      code: 'FORBIDDEN_DEVELOPER_SETTINGS',
    },
    shows: () => settings('credentials.errors.forbidden'),
  },
  {
    name: 'an SSO reuse for another app',
    status: 400,
    body: {
      error:
        'Only the Microsoft 365 import app can reuse the Entra ID SSO registration.',
      code: 'sso_reuse_unsupported',
    },
    shows: () => settings('connectors.oauthApps.errors.ssoReuseUnsupported'),
  },
  {
    name: 'a removal of an app that is not configured',
    status: 404,
    body: { error: 'OAuth app not configured.', code: 'oauth_app_not_found' },
    shows: () => settings('connectors.oauthApps.errors.notFound'),
  },
];

/** The door's English sentence, wherever its body carries it. */
function sentenceOf(body: Record<string, unknown>): string {
  return String(body['code'] === undefined ? body['message'] : body['error']);
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('mapConnectorError', () => {
  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    it.each(REFUSALS)(
      'words $name from the catalog',
      async ({ status, body, vendor, shows }) => {
        await i18n.changeLanguage(locale);
        const refusal = await answered(status, body);

        const shown = mapConnectorError(refusal, vendor);
        expect(shown).toBe(shows());
        // Every placeholder filled in, none left as written.
        expect(shown).not.toMatch(/[{}]/);
        expect(shown).not.toBe(sentenceOf(body));
        if (locale !== 'en') {
          const english = await (async () => {
            await i18n.changeLanguage('en');
            const text = shows();
            await i18n.changeLanguage(locale);
            return text;
          })();
          expect(shown).not.toBe(english);
        }
      },
    );
  });

  it('keeps the limits as the server sent them', async () => {
    await i18n.changeLanguage('de');
    const refusal = await answered(400, REFUSALS[5]?.body);
    // A port reads 65535 in every locale, never 65.535.
    expect(mapConnectorError(refusal, imapSmtp)).toContain('65535');
  });

  it('names a connector the dialog does not show by its slug', async () => {
    const refusal = await answered(400, {
      error: 'CREDENTIAL_ENDPOINT_REQUIRED',
      message:
        'Connector "forgejo" uses one endpoint per credential — enter the instance URL.',
      data: { connector: 'forgejo' },
    });
    expect(mapConnectorError(refusal, github)).toBe(
      settings('connectors.errors.endpointRequired', { connector: 'forgejo' }),
    );
  });

  it('names a setting the vendor does not declare by its key', async () => {
    const refusal = await answered(400, {
      error: 'CREDENTIAL_CONFIG_INVALID',
      message: 'Connector "imap-smtp" has no setting "folder".',
      data: { connector: 'imap-smtp', field: 'folder', reason: 'unknown' },
    });
    expect(mapConnectorError(refusal, imapSmtp)).toBe(
      settings('connectors.errors.configUnknown', {
        connector: 'IMAP / SMTP Mailbox',
        field: 'folder',
      }),
    );
  });

  // The app's rule for a refusal (`failureDetail`): one this surface cannot
  // word keeps the words its handler wrote.
  it('keeps the words of a refusal without what its sentence needs', async () => {
    const refusal = await answered(400, {
      error: 'AUTH_METHOD_NOT_SUPPORTED',
      message: 'Connector "github" does not accept api-key credentials.',
    });
    expect(mapConnectorError(refusal, github)).toBe(
      'Connector "github" does not accept api-key credentials.',
    );
  });

  it('still words the codes both credential surfaces share', async () => {
    await i18n.changeLanguage('fr');
    const refusal = await answered(409, {
      error: 'CREDENTIAL_NAME_TAKEN',
      message:
        'A credential named "Production" already exists for this connector — pick a different name.',
    });
    expect(mapConnectorError(refusal, github)).toBe(
      settings('credentials.errors.nameTaken'),
    );
  });

  it('says something went wrong for an app row the write did not return', async () => {
    const fault = await answered(400, {
      error: 'Could not store the OAuth app.',
      code: 'write_failed',
    });
    expect(connectorFailureDetail(fault)).toBeUndefined();
    expect(mapConnectorError(fault)).toBe(
      i18n.t('errors.generic', { ns: 'common' }),
    );
  });
});
