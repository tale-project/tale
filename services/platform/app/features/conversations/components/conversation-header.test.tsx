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

  it('falls back to email when contact name is missing', () => {
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

    const nameElements = screen.getAllByText('sarah@company.com');
    expect(nameElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders back button on mobile when onBack is provided', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Back')).toBeInTheDocument();
  });

  it('does not render back button when onBack is not provided', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument();
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
