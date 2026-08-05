import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { connectorConfigExtras } from './config-fields';
import { type ConnectorSummary } from './hooks/backend';

/**
 * The bug these cover: `createCredential` validates a connector's submitted
 * config against its declared `configFields` and refuses a missing required
 * one, but the create dialog installed `noExtras()` — so it rendered no field
 * for them and `imap-smtp` failed with `needs "IMAP server"` while offering no
 * way to supply it.
 */

function summary(
  configFields: ConnectorSummary['configFields'],
): ConnectorSummary {
  return {
    slug: 'imap-smtp',
    displayName: 'IMAP / SMTP Mailbox',
    description: 'A private mailbox.',
    tags: ['Email'],
    endpointMode: 'fixed',
    authMethods: ['basic'],
    configFields,
    actionCount: 2,
  };
}

const imapSmtpFields: ConnectorSummary['configFields'] = [
  { key: 'imapHost', label: 'IMAP server', type: 'string', required: true },
  {
    key: 'imapPort',
    label: 'IMAP port',
    type: 'number',
    required: false,
    default: 993,
  },
  { key: 'smtpHost', label: 'SMTP server', type: 'string', required: true },
  {
    key: 'security',
    label: 'Connection security',
    type: 'string',
    required: false,
    enum: ['tls', 'starttls'],
    default: 'tls',
  },
];

const extras = connectorConfigExtras<
  { summary: ConnectorSummary },
  { config?: Record<string, string | number | boolean> }
>();

describe('connectorConfigExtras', () => {
  it('is incomplete until every required field is supplied', () => {
    const vendor = { summary: summary(imapSmtpFields) };
    expect(extras.isComplete?.({}, vendor)).toBe(false);
    expect(extras.isComplete?.({ imapHost: 'mail.example.com' }, vendor)).toBe(
      false,
    );
    expect(
      extras.isComplete?.(
        { imapHost: 'mail.example.com', smtpHost: 'smtp.example.com' },
        vendor,
      ),
    ).toBe(true);
  });

  it('treats whitespace as unsupplied, so a spacebar does not satisfy a required field', () => {
    const vendor = { summary: summary(imapSmtpFields) };
    expect(
      extras.isComplete?.(
        { imapHost: '   ', smtpHost: 'smtp.example.com' },
        vendor,
      ),
    ).toBe(false);
  });

  it('counts a field with a declared default as satisfied — the server applies it', () => {
    const vendor = {
      summary: summary([
        {
          key: 'sentMailbox',
          label: 'Sent folder',
          type: 'string',
          required: true,
          default: 'Sent',
        },
      ]),
    };
    expect(extras.isComplete?.({}, vendor)).toBe(true);
  });

  it('is complete for a connector declaring no config at all', () => {
    expect(extras.isComplete?.({}, { summary: summary([]) })).toBe(true);
  });

  it('sends blank entries as ABSENT so the server applies declared defaults', () => {
    // '' would be rejected for a number field and would override the default
    // for a string one, so a field the user never filled must not be sent.
    expect(
      extras.createArgs({
        imapHost: 'mail.example.com',
        imapPort: '',
        security: '',
      }),
    ).toEqual({ config: { imapHost: 'mail.example.com' } });
  });

  it('contributes nothing when no config was entered', () => {
    expect(extras.createArgs({})).toEqual({});
  });

  it('keeps false and 0, which are answers rather than omissions', () => {
    expect(extras.createArgs({ imapSecure: false, imapPort: 0 })).toEqual({
      config: { imapSecure: false, imapPort: 0 },
    });
  });

  it('round-trips stored config into the edit form', () => {
    // updateCredential replaces config wholesale, so an edit dialog seeded with
    // {} would clear it on save — this is why the listing returns config.
    const stored = { imapHost: 'mail.example.com', imapPort: 993 };
    expect(extras.fromCredential({ config: stored })).toEqual(stored);
    expect(extras.fromCredential({})).toEqual({});
  });

  it('reports dirty only when a value actually changed', () => {
    const baseline = { imapHost: 'mail.example.com' };
    expect(extras.isDirty({ imapHost: 'mail.example.com' }, baseline)).toBe(
      false,
    );
    expect(extras.isDirty({ imapHost: 'other.example.com' }, baseline)).toBe(
      true,
    );
  });

  it('renders a field per declared setting, and nothing at all when none are declared', () => {
    // Nothing rather than an empty fragment, so the dialog grows no blank gap
    // for the majority of connectors that declare no settings.
    const Fields = extras.Fields;
    expect(Fields).not.toBeNull();
    if (Fields === null) return;

    const bare = render(
      <Fields
        vendor={{ summary: summary([]) }}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(bare.container).toBeEmptyDOMElement();
    bare.unmount();

    render(
      <Fields
        vendor={{ summary: summary(imapSmtpFields) }}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox', { name: /^IMAP server/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: /^SMTP server/ })).toBeVisible();
    // The declared default is a placeholder, not a value — an untouched field
    // must stay distinguishable from a chosen one.
    expect(screen.getByRole('textbox', { name: /^IMAP port/ })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /^IMAP port/ })).toHaveAttribute(
      'placeholder',
      '993',
    );
  });

  it('hides fromAddress — it is mirrored from the IMAP username, not typed twice', () => {
    const Fields = extras.Fields;
    expect(Fields).not.toBeNull();
    if (Fields === null) return;

    render(
      <Fields
        vendor={{
          summary: summary([
            ...imapSmtpFields,
            {
              key: 'fromAddress',
              label: 'From address',
              type: 'string',
              required: false,
            },
          ]),
        }}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('textbox', { name: /^IMAP server/ })).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: /^From address/ }),
    ).not.toBeInTheDocument();
  });

  it('round-trips the hidden fromAddress it never renders', () => {
    // Hidden ≠ dropped: `editArgs` replaces config as a whole, so the stored
    // mirror has to survive an edit that only touches the visible fields.
    const stored = { imapHost: 'mail.example.com', fromAddress: 'a@b.test' };
    const value = extras.fromCredential({ config: stored });
    expect(
      extras.editArgs({ ...value, imapHost: 'other.example.com' }),
    ).toEqual({
      config: { imapHost: 'other.example.com', fromAddress: 'a@b.test' },
    });
  });
});
