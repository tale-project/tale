import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import { ConversationHeader } from './conversation-header';

import '@/app/globals.css';

vi.mock('@/app/features/contacts/hooks/queries', () => ({
  useContacts: () => ({ contacts: [] }),
  useContactById: () => null,
}));
vi.mock('@/app/features/contacts/components/contact-info-popover', () => ({
  ContactInfoPopover: ({ trigger }: { trigger: React.ReactNode }) => (
    <>{trigger}</>
  ),
}));
vi.mock('./conversation-assignee-picker', () => ({
  ConversationAssigneePicker: () => null,
}));
vi.mock('../hooks/queries', () => ({
  useMailboxes: () => ({ mailboxes: [] }),
}));
vi.mock('../hooks/mutations', () => ({
  useCloseConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useReopenConversation: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAsSpam: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({ formatRelative: () => '2 min ago' }),
}));

const EMAIL = 'sarah.johnson@example-company.com';

function renderHeader(width: number, name = 'Sarah Johnson') {
  const now = new Date().toISOString();
  render(
    <div style={{ width }}>
      <ConversationHeader
        organizationId="org-1"
        conversation={{
          _id: 'conv-1',
          _creationTime: Date.now(),
          organizationId: 'org-1',
          id: 'conv-1',
          title: 'Refund for the annual plan',
          subject: 'Refund for the annual plan',
          description: '',
          contact_id: 'contact-1',
          business_id: 'biz-1',
          message_count: 2,
          unread_count: 0,
          last_message_at: now,
          created_at: now,
          updated_at: now,
          status: 'open',
          contactId: 'contact-1',
          channel: 'api',
          connectorName: 'helpdesk',
          metadata: {},
          contact: {
            id: 'contact-1',
            name,
            email: EMAIL,
            source: 'api',
            locale: 'en',
            created_at: now,
          },
          messages: [],
        }}
      />
    </div>,
  );
  return screen.getByRole('button', { name });
}

// Where an item of the context line ends up: on the line, or wrapped below
// it where the row clips it away. An item the clip cuts through is neither.
function placement(item: HTMLElement, row: HTMLElement) {
  const line = row.getBoundingClientRect();
  const box = item.getBoundingClientRect();
  if (box.top >= line.top && box.bottom <= line.bottom) return 'shown';
  if (box.top >= line.bottom) return 'dropped';
  return 'cut';
}

function rowOf(name: HTMLElement) {
  // oxlint-disable-next-line testing-library/no-node-access -- the clipping row is structural, not a queryable role
  return name.parentElement as HTMLElement;
}

function contextLine(name: HTMLElement) {
  const row = rowOf(name);
  return {
    time: placement(screen.getByText('2 min ago'), row),
    email: placement(screen.getByText(EMAIL), row),
    source: placement(screen.getByText('API: helpdesk'), row),
  };
}

const whole = (el: HTMLElement) => el.scrollWidth <= el.clientWidth;

beforeEach(async () => {
  // Desktop chrome: a tablet's page column is narrow while the window is not,
  // which is where gating the line on the window cut every item to a letter.
  await page.viewport(1024, 768);
});

afterEach(cleanup);

describe('ConversationHeader context line (real layout)', () => {
  it('shows every item where the line has room', () => {
    const name = renderHeader(1000);
    expect(whole(name)).toBe(true);
    expect(contextLine(name)).toEqual({
      time: 'shown',
      email: 'shown',
      source: 'shown',
    });
  });

  it('drops whole items from the end of a narrow line, never the name', () => {
    // ~250px for the line: a tablet's column beside the rail and a panel.
    const name = renderHeader(420);
    expect(whole(name)).toBe(true);
    expect(contextLine(name)).toEqual({
      time: 'shown',
      email: 'dropped',
      source: 'dropped',
    });
  });

  it('truncates the name only when it alone overflows the line', () => {
    const name = renderHeader(
      420,
      'Maximiliane Alexandra von Hohenzollern-Sigmaringen',
    );
    expect(whole(name)).toBe(false);
    expect(placement(name, rowOf(name))).toBe('shown');
    expect(contextLine(name)).toEqual({
      time: 'dropped',
      email: 'dropped',
      source: 'dropped',
    });
  });
});
