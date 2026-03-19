// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { ConversationHeader } from '../conversation-header';

vi.mock('@/app/features/customers/hooks/queries', () => ({
  useCustomers: () => ({ customers: [] }),
  useCustomerById: () => null,
}));

vi.mock('@/app/features/customers/components/customer-info-popover', () => ({
  CustomerInfoPopover: ({
    trigger,
  }: {
    trigger: React.ReactNode;
    customer: unknown;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => <>{trigger}</>,
}));

vi.mock('../../hooks/mutations', () => ({
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
    customer_id: 'cust-1',
    business_id: 'biz-1',
    message_count: 5,
    unread_count: 0,
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'open' as const,
    customerId: 'cust-1',
    customer: {
      id: 'cust-1',
      name: 'Sarah Johnson',
      email: 'sarah@company.com',
      status: 'active',
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

  it('renders customer name and email', () => {
    render(
      <ConversationHeader
        conversation={makeConversation()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('renders avatar initial from customer name', () => {
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

  it('falls back to email when customer name is missing', () => {
    render(
      <ConversationHeader
        conversation={makeConversation({
          customer: {
            id: 'cust-1',
            name: undefined,
            email: 'sarah@company.com',
            status: 'active',
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
});
