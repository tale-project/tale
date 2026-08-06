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

// The From-source line reads email connectors via a Convex query; stub it so
// the header renders without a live Convex client. Override per-test via
// `emailConnectorsMock`.
const emailConnectorsMock = vi.hoisted(() => ({
  current: [] as Array<{
    slug: string;
    title: string;
    type: string;
    fromAddress?: string;
  }>,
}));

vi.mock('../hooks/queries', () => ({
  useEmailConnectors: () => ({
    emailConnectors: emailConnectorsMock.current,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAsSpam: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
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

vi.mock('@/app/hooks/use-toast', () => ({
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
  emailConnectorsMock.current = [];
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

  it('renders avatar initial from contact name', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('S')).toBeInTheDocument();
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
    // Mobile hides the sender email (contact info already has it); md+ keeps it.
    expect(email).toHaveClass('hidden', 'md:inline');
  });

  it('reveals a hidden meta separator as a flex box, never a bare inline', () => {
    const { container } = render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    const separators = [...container.querySelectorAll('span.size-4')];
    const responsive = separators.filter((dot) =>
      dot.className.includes('hidden'),
    );
    expect(responsive.length).toBeGreaterThan(0);
    // `md:inline` would blockify inside the flex meta row, and the dot would
    // ride at the top of the separator's box instead of on the text midline.
    for (const dot of responsive) {
      expect(dot).toHaveClass('md:inline-flex');
    }
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
    emailConnectorsMock.current = [
      {
        slug: 'gmail',
        title: 'Gmail',
        type: 'oauth',
        fromAddress: 'desk@gmail.com',
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

    expect(screen.getByText('desk@gmail.com')).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Inbox: stranger@gmail.com'),
    ).not.toBeInTheDocument();
  });

  it('shows the IMAP login From when config.fromAddress mirrors username', () => {
    emailConnectorsMock.current = [
      {
        slug: 'imap-smtp',
        title: 'IMAP / SMTP Mailbox',
        type: 'imap_smtp',
        fromAddress: 'hello@acme.test',
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
    emailConnectorsMock.current = [
      { slug: 'gmail', title: 'Gmail', type: 'oauth' },
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
    emailConnectorsMock.current = [
      { slug: 'gmail', title: 'Gmail', type: 'oauth' },
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
});
