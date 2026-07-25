// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import type { Integration } from '../../hooks/use-integration-manage';
import { IntegrationCredentialsForm } from './integration-credentials-form';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// SlackSetupGuide pulls Convex queries not available here; it's never rendered
// in these cases (non-slack), but stub it to be safe.
vi.mock('./slack-setup-guide', () => ({ SlackSetupGuide: () => null }));

type FormProps = Parameters<typeof IntegrationCredentialsForm>[0];

function makeProps(integration: Integration): FormProps {
  return {
    integration,
    isSql: false,
    busy: false,
    isSavingOAuth2: false,
    selectedAuthMethod: 'basic_auth',
    supportedMethods: ['basic_auth'],
    hasMultipleAuthMethods: false,
    hasOAuth2Config: false,
    hasOAuth2Credentials: false,
    oauth2Fields: {
      authorizationUrl: '',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      signingSecret: '',
      scopes: '',
    },
    oauth2FieldsComplete: false,
    isEditingOAuth2: false,
    credentials: {},
    smtpSeparate: false,
    fromSameAsUsername: false,
    displayBindings: ['username', 'password'],
    editableConfigFields: [],
    configValues: {},
    sqlConfig: {},
    testResult: null,
    onAuthMethodChange: vi.fn(),
    onCredentialChange: vi.fn(),
    onSmtpSeparateChange: vi.fn(),
    onFromSameAsUsernameChange: vi.fn(),
    onConfigValueChange: vi.fn(),
    onSqlConfigChange: vi.fn(),
    onOAuth2FieldChange: vi.fn(),
    onEditOAuth2: vi.fn(),
    onSaveOAuth2: vi.fn(),
    onDismissTestResult: vi.fn(),
  };
}

function makeIntegration(type: string): Integration {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal Integration fixture
  return {
    _id: 'cred-1',
    title: 'Mailbox',
    name: type,
    type,
    authMethod: 'basic_auth',
  } as Integration;
}

describe('IntegrationCredentialsForm — SMTP fields', () => {
  it('shows the separate-provider toggle for imap_smtp', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
      />,
    );

    // Two imap_smtp switches now: separate-SMTP provider + send-from-mailbox.
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(
      screen.getByText('integrations.manageDialog.smtpSeparateToggle'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('integrations.manageDialog.fromSameAsUsername'),
    ).toBeInTheDocument();
  });

  it('hides the SMTP credential fields while the toggle is off', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
      />,
    );

    expect(
      screen.queryByLabelText('integrations.manageDialog.smtpUsername'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('integrations.manageDialog.smtpHint'),
    ).not.toBeInTheDocument();
  });

  it('reveals the SMTP credential fields when the toggle is on', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
        smtpSeparate
      />,
    );

    expect(
      screen.getByLabelText('integrations.manageDialog.smtpUsername'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('integrations.manageDialog.smtpPassword'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('integrations.manageDialog.smtpHint'),
    ).toBeInTheDocument();
  });

  it('does not render the SMTP toggle or fields for a normal REST integration', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('rest_api'))}
      />,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText('integrations.manageDialog.smtpUsername'),
    ).not.toBeInTheDocument();
  });
});

describe('IntegrationCredentialsForm — imap_smtp config controls', () => {
  const configFields = [
    { key: 'imapSecure', type: 'string' as const, defaultValue: 'true' },
    { key: 'fromAddress', type: 'string' as const, defaultValue: '' },
  ];

  it('renders secure config keys as switches, not text inputs', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
        editableConfigFields={configFields}
      />,
    );
    // imapSecure is a boolean-ish key → rendered as a switch (its i18n label),
    // never the raw "Imap Secure" text input.
    expect(
      screen.getByText('integrations.manageDialog.imapSecure'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Imap Secure')).not.toBeInTheDocument();
  });

  it('hides the From field while "send from my mailbox address" is on', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
        editableConfigFields={configFields}
        fromSameAsUsername
      />,
    );
    expect(screen.queryByLabelText('From Address')).not.toBeInTheDocument();
  });

  it('shows the From field when the toggle is off', () => {
    render(
      <IntegrationCredentialsForm
        {...makeProps(makeIntegration('imap_smtp'))}
        editableConfigFields={configFields}
        fromSameAsUsername={false}
      />,
    );
    expect(screen.getByLabelText('From Address')).toBeInTheDocument();
  });
});
