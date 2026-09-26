// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ConversationHeader } from './conversation-header';

vi.mock('@/app/features/contacts/hooks/queries', () => ({
  useContacts: () => ({ contacts: [] }),
  useContactById: () => null,
}));

vi.mock('@/app/features/contacts/components/contact-info-popover', () => ({
  ContactInfoPopover: ({
    trigger,
  }: {
    trigger: React.ReactNode;
    contact: unknown;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => <>{trigger}</>,
}));

// Stub the assignee picker (it reads live member context via Convex auth) so
// the header renders in isolation.
vi.mock('./conversation-assignee-picker', () => ({
  ConversationAssigneePicker: () => null,
}));

// The From-source line reads the org's mailboxes (connector credentials) via
// a backend query; stub it so the header renders without a live client.
// Override per-test via `mailboxesMock`.
const mailboxesMock = vi.hoisted(() => ({
  current: [] as Array<{
    id: string;
    connectorSlug: string;
    name: string;
    status: string;
    config?: Record<string, string>;
  }>,
}));

vi.mock('../hooks/queries', () => ({
  useMailboxes: () => ({ mailboxes: mailboxesMock.current }),
}));

vi.mock('../hooks/mutations', () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAsSpam: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => '2 min ago',
    formatDate: () => 'Jan 1, 2025',
    formatDateSmart: () => 'Today',
    formatDateHeader: () => 'Today',
    locale: 'en',
    timezone: 'UTC',
    timezoneShort: 'UTC',
  }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

function makeConversation(overrides = {}) {
  return {
    _id: 'conv-1',
    _creationTime: Date.now(),
    organizationId: 'org-1',
    id: 'conv-1',
    title: 'Project proposal feedback',
    subject: 'Re: Project proposal feedback',
    description: 'A conversation about project proposal',
    contact_id: 'contact-1',
    business_id: 'biz-1',
    message_count: 5,
    unread_count: 0,
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'open' as const,
    contactId: 'contact-1',
    contact: {
      id: 'contact-1',
      name: 'Sarah Johnson',
      email: 'sarah@company.com',
      source: 'api',
      locale: 'en',
      created_at: new Date().toISOString(),
    },
    messages: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mailboxesMock.current = [];
  vi.clearAllMocks();
});

describe('ConversationHeader', () => {
  it('renders subject text', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(
      screen.getByText('Re: Project proposal feedback'),
    ).toBeInTheDocument();
  });

  it('renders contact name and email', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('renders the contact initials as its identity mark', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    // The same tinted initials the Home list shows for this contact.
    expect(screen.getByText('SJ')).toBeInTheDocument();
  });

  it('renders relative time for last message', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('2 min ago')).toBeInTheDocument();
  });

  it('renders more action button', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByLabelText('More actions')).toBeInTheDocument();
  });

  it('falls back to title when subject is missing', () => {
    render(
      <ConversationHeader
        conversation={makeConversation({ subject: undefined })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('Project proposal feedback')).toBeInTheDocument();
  });

  it('falls back to email when contact name is missing without duplicating it on the meta line', () => {
    render(
      <ConversationHeader
        conversation={makeConversation({
          contact: {
            id: 'contact-1',
            name: undefined,
            email: 'sarah@company.com',
            source: 'api',
            locale: 'en',
            created_at: new Date().toISOString(),
          },
        })}
        organizationId="org-1"
      />,
    );

    // Primary shows the email; the meta line must not repeat it (that doubled
    // the string on phone widths and forced the timestamp to wrap mid-phrase).
    expect(screen.getAllByText('sarah@company.com')).toHaveLength(1);
    expect(screen.getByText('2 min ago')).toHaveClass('whitespace-nowrap');
  });

  it('keeps the contact email on the meta line for desktop widths only', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    const email = screen.getByText('sarah@company.com');
    expect(email).toBeInTheDocument();
    // Mobile hides the sender email (contact info already has it); md+ keeps
    // it — the wrapper that also holds its separator carries the breakpoint.
    // oxlint-disable-next-line testing-library/no-node-access -- the responsive wrapper is structural, not a queryable role
    expect(email.parentElement).toHaveClass('hidden', 'md:inline-flex');
  });

  it('hides the email together with its separator on small screens', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    // A lone separator left between the name and the time would read "· ·".
    // `md:inline-flex`, not `md:inline`: the meta row is a flex box, and an
    // inline child would ride off the text midline.
    const email = screen.getByText('sarah@company.com');
    // oxlint-disable-next-line testing-library/no-node-access -- the responsive wrapper is structural, not a queryable role
    const group = email.parentElement;
    expect(group).toHaveClass('hidden', 'md:inline-flex');
    expect(group?.textContent).toContain('·');
  });

  it('does not render a back control (back lives in the page header)', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
  });

  it('shows the connected mailbox From, not a different @gmail.com To', () => {
    mailboxesMock.current = [
      {
        id: 'cred-gmail',
        connectorSlug: 'gmail',
        name: 'Gmail',
        status: 'active',
        config: { fromAddress: 'desk@gmail.com' },
      },
    ];
    render(
      <ConversationHeader
        conversation={makeConversation({
          connectorName: 'gmail',
          metadata: {
            to: [{ address: 'stranger@gmail.com' }],
          },
          contact: {
            id: 'contact-1',
            name: 'Stranger',
            email: 'stranger@gmail.com',
            source: 'api',
            locale: 'en',
            created_at: new Date().toISOString(),
          },
        })}
        organizationId="org-1"
      />,
    );

    // The connector's name now leads the address, so match within the line.
    expect(screen.getByText(/desk@gmail\.com/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Inbox: stranger@gmail.com'),
    ).not.toBeInTheDocument();
  });

  it('shows the IMAP login From when config.fromAddress mirrors username', () => {
    mailboxesMock.current = [
      {
        id: 'cred-imap',
        connectorSlug: 'imap-smtp',
        name: 'IMAP / SMTP Mailbox',
        status: 'active',
        config: { fromAddress: 'hello@acme.test' },
      },
    ];
    render(
      <ConversationHeader
        conversation={makeConversation({
          connectorName: 'imap-smtp',
          metadata: {
            to: [{ address: 'hello@acme.test' }],
          },
          contact: {
            id: 'contact-1',
            name: 'Jordan',
            email: 'jordan@customer.test',
            source: 'api',
            locale: 'en',
            created_at: new Date().toISOString(),
          },
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByLabelText('Inbox: hello@acme.test')).toBeInTheDocument();
  });

  it('reads the sender, not the To, as the mailbox on a sent-folder thread', () => {
    // Sent-folder mail synced back: `direction: outbound`, `metadata.to` is the
    // CONTACT. gmail/outlook expose no configured From, so reading `to` blindly
    // is what showed an unconnected personal address as the inbox source.
    mailboxesMock.current = [
      {
        id: 'cred-gmail',
        connectorSlug: 'gmail',
        name: 'Gmail',
        status: 'active',
      },
    ];
    render(
      <ConversationHeader
        conversation={makeConversation({
          connectorName: 'gmail',
          direction: 'outbound' as const,
          metadata: {
            from: [{ address: 'desk@gmail.com' }],
            to: [{ address: 'stranger@gmail.com' }],
          },
          contact: {
            id: 'contact-1',
            name: undefined,
            email: 'stranger@gmail.com',
            source: 'api',
            locale: 'en',
            created_at: new Date().toISOString(),
          },
        })}
        organizationId="org-1"
      />,
    );

    expect(screen.getByLabelText('Inbox: desk@gmail.com')).toBeInTheDocument();
    // The contact's address stays the primary line only — never repeated as the
    // mailbox it was sent to.
    expect(screen.getAllByText('stranger@gmail.com')).toHaveLength(1);
  });

  it('still names the mailbox on inbound mail when the connector exposes no From', () => {
    // The multi-mailbox fan-out makes this the signal that says WHICH inbox a
    // thread arrived at; gmail/outlook have no `config.fromAddress` to fall back
    // on, so the inbound envelope's recipient has to carry it.
    mailboxesMock.current = [
      {
        id: 'cred-gmail',
        connectorSlug: 'gmail',
        name: 'Gmail',
        status: 'active',
      },
    ];
    render(
      <ConversationHeader
        conversation={makeConversation({
          connectorName: 'gmail',
          direction: 'inbound' as const,
          metadata: {
            from: [{ address: 'jordan@customer.test' }],
            to: [{ address: 'support@acme.test' }],
          },
        })}
        organizationId="org-1"
      />,
    );

    expect(
      screen.getByLabelText('Inbox: support@acme.test'),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ConversationHeader
          conversation={makeConversation()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });

  /**
   * With two connectors installed the address alone does not say which one
   * carries the thread, so the connector's name is shown rather than hidden
   * in a tooltip. An API thread has no envelope address at all and used to
   * show nothing.
   */
  describe('where the thread came in', () => {
    it('names the connector beside the address', () => {
      mailboxesMock.current = [
        {
          id: 'cred-gmail',
          connectorSlug: 'gmail',
          name: 'Gmail',
          status: 'active',
        },
      ];
      render(
        <ConversationHeader
          conversation={makeConversation({
            channel: 'email',
            connectorName: 'gmail',
            metadata: { to: [{ address: 'desk@company.test' }] },
          })}
          organizationId="org-1"
        />,
      );

      expect(screen.getByText('Gmail · desk@company.test')).toBeInTheDocument();
    });

    it('names the source of an API thread, which carries no address', () => {
      mailboxesMock.current = [];
      render(
        <ConversationHeader
          conversation={makeConversation({
            channel: 'api',
            connectorName: 'helpdesk',
            metadata: {},
          })}
          organizationId="org-1"
        />,
      );

      expect(screen.getByText('API: helpdesk')).toBeInTheDocument();
    });

    // Says nothing rather than something wrong.
    it('shows no source when the thread carries neither stamp', () => {
      mailboxesMock.current = [];
      render(
        <ConversationHeader
          conversation={makeConversation({ metadata: {} })}
          organizationId="org-1"
        />,
      );

      expect(screen.queryByText(/^API:/)).not.toBeInTheDocument();
    });
  });

  /**
   * One connector, two mailboxes. The name used to be looked up by connector,
   * which kept only the last mailbox listed, so a thread written to General
   * Support read "Recruitment Support · hello@…".
   */
  describe('two mailboxes on one connector', () => {
    const GENERAL = {
      id: 'cred-general',
      connectorSlug: 'imap-smtp',
      name: 'General Support',
      status: 'active',
      config: { fromAddress: 'hello@support.test' },
    };
    const RECRUITMENT = {
      id: 'cred-recruitment',
      connectorSlug: 'imap-smtp',
      name: 'Recruitment Support',
      status: 'active',
      config: { fromAddress: 'jobs@support.test' },
    };

    it('names the mailbox the thread was placed on, not the last one listed', () => {
      mailboxesMock.current = [GENERAL, RECRUITMENT];
      render(
        <ConversationHeader
          conversation={makeConversation({
            channel: 'email',
            connectorName: 'imap-smtp',
            credentialId: 'cred-general',
            direction: 'inbound' as const,
            metadata: { to: [{ address: 'hello@support.test' }] },
          })}
          organizationId="org-1"
        />,
      );

      expect(
        screen.getByText('General Support · hello@support.test'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Recruitment Support/)).not.toBeInTheDocument();
    });

    it('shows the address alone when the thread was not placed', () => {
      mailboxesMock.current = [GENERAL, RECRUITMENT];
      render(
        <ConversationHeader
          conversation={makeConversation({
            channel: 'email',
            connectorName: 'imap-smtp',
            direction: 'inbound' as const,
            metadata: { to: [{ address: 'hello@support.test' }] },
          })}
          organizationId="org-1"
        />,
      );

      expect(screen.getByText('hello@support.test')).toBeInTheDocument();
      expect(screen.queryByText(/Support ·/)).not.toBeInTheDocument();
    });
  });
});
