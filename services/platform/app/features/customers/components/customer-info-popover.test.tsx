import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { CustomerInfoPopover } from './customer-info-popover';

function makeCustomerDoc(overrides = {}) {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'Sarah Johnson',
    email: 'sarah@company.com',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en-US',
    ...overrides,
  };
}

function makeCustomerInfo(overrides = {}) {
  return {
    id: 'customer-1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    status: 'active',
    source: 'api',
    locale: 'en',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderPopover(
  props: Partial<React.ComponentProps<typeof CustomerInfoPopover>> = {},
) {
  const defaultProps = {
    customer: makeCustomerDoc(),
    open: true,
    onOpenChange: vi.fn(),
    trigger: <button>Open</button>,
    ...props,
  };
  return render(<CustomerInfoPopover {...defaultProps} />);
}

describe('CustomerInfoPopover', () => {
  it('renders customer name and email when open', () => {
    renderPopover();

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('renders status badge for valid customer status', () => {
    renderPopover();

    const badges = screen.getAllByText('Active');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders info rows with locale and source', () => {
    renderPopover();

    expect(screen.getByText('en-US')).toBeInTheDocument();
    expect(screen.getByText('Manual Import')).toBeInTheDocument();
  });

  it('renders with CustomerInfo fallback data', () => {
    renderPopover({ customer: makeCustomerInfo() });

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('renders trigger element', () => {
    renderPopover({ open: false });

    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('handles missing customer name gracefully', () => {
    renderPopover({ customer: makeCustomerDoc({ name: undefined }) });

    expect(screen.getByText('sarah@company.com')).toBeInTheDocument();
  });

  it('handles missing source gracefully', () => {
    renderPopover({ customer: makeCustomerDoc({ source: undefined }) });

    expect(screen.getByText('Sarah Johnson')).toBeInTheDocument();
  });
});
