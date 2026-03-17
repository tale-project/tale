import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { CustomerInfoDialog } from './customer-info-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeCustomerDoc(overrides = {}) {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'John Doe',
    email: 'john@example.com',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

function makeCustomerInfo(overrides = {}) {
  return {
    id: 'customer-1',
    name: 'Unknown Customer',
    email: 'unknown@example.com',
    status: 'active',
    source: 'unknown',
    locale: 'en',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('CustomerInfoDialog', () => {
  it('renders with full customer document', () => {
    render(
      <CustomerInfoDialog
        customer={makeCustomerDoc()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('renders with CustomerInfo fallback data', () => {
    render(
      <CustomerInfoDialog
        customer={makeCustomerInfo()}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Unknown Customer')).toBeInTheDocument();
    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('renders with CustomerInfo when name is missing', () => {
    render(
      <CustomerInfoDialog
        customer={makeCustomerInfo({ name: undefined })}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('unknown@example.com')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    render(
      <CustomerInfoDialog
        customer={makeCustomerInfo()}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Unknown Customer')).not.toBeInTheDocument();
  });
});
