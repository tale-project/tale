// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { Conversation } from '../types';
import { ConversationsList } from './conversations-list';

// Builds a conversation fixture. Fields that the list reads (title, customer,
// unread_count, etc.) can be overridden per test; the rest are filler.
function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    _id: 'conv-1',
    _creationTime: Date.now(),
    organizationId: 'org-1',
    id: 'conv-1',
    title: 'Re: Refund request',
    subject: 'Re: Refund request',
    description: 'A conversation about a refund',
    channel: 'Email',
    type: 'General',
    customer_id: 'cust-1',
    customerId: 'cust-1',
    business_id: 'biz-1',
    message_count: 1,
    unread_count: 0,
    last_message_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'open',
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
  } as unknown as Conversation;
}

afterEach(() => {
  cleanup();
});

describe('ConversationsList accessibility', () => {
  it('uses the conversation subject as the select button accessible name', () => {
    render(
      <ConversationsList
        conversations={[
          makeConversation({ id: 'c1', title: 'Re: Refund request' }),
        ]}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Re: Refund request' }),
    ).toBeInTheDocument();
  });

  it('gives two name-less conversations distinct accessible names from their subjects', () => {
    render(
      <ConversationsList
        conversations={[
          makeConversation({
            id: 'c1',
            title: 'Where is my package?',
            customer: undefined,
          }),
          makeConversation({
            id: 'c2',
            title: 'Cancel my subscription',
            customer: undefined,
          }),
        ]}
      />,
    );

    // Both rows are name-less, but their subject-derived labels keep them
    // distinguishable to screen-reader users.
    expect(
      screen.getByRole('button', { name: 'Where is my package?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Cancel my subscription' }),
    ).toBeInTheDocument();
  });

  it('renders the localized unknownCustomer fallback when neither name nor subject exist', () => {
    render(
      <ConversationsList
        conversations={[
          makeConversation({
            id: 'c1',
            title: '',
            subject: '',
            customer: undefined,
          }),
        ]}
      />,
    );

    // From conversations.unknownCustomer in en.json. The heading and the select
    // button both fall back to the localized label.
    expect(screen.getAllByText('Unknown customer').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Unknown customer' }),
    ).toBeInTheDocument();
  });

  it('labels the load-more spinner with the localized pagination string', () => {
    render(
      <ConversationsList
        conversations={[makeConversation({ id: 'c1' })]}
        paginationStatus="LoadingMore"
      />,
    );

    // From common.pagination.loading in en.json (the old
    // conversations.history.loadingMore key never existed).
    expect(screen.getByLabelText('Loading more...')).toBeInTheDocument();
  });
});
