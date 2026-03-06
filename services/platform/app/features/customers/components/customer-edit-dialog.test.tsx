// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils/render';

import { CustomerEditDialog } from './customer-edit-dialog';

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateCustomer: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeCustomer(overrides = {}) {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    email: 'test@example.com',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('CustomerEditDialog', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(undefined);
  });

  it('renders with customer data', () => {
    render(
      <CustomerEditDialog
        customer={makeCustomer({ name: 'John' })}
        isOpen={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
  });

  it('submits when customer has no name', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <CustomerEditDialog
        customer={makeCustomer({ name: undefined })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const emailInput = screen.getByDisplayValue('test@example.com');
    await user.clear(emailInput);
    await user.type(emailInput, 'new@example.com');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        customerId: 'customer-1',
        name: undefined,
        email: 'new@example.com',
        locale: 'en',
      });
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('submits with name when customer has a name', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <CustomerEditDialog
        customer={makeCustomer({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);
    await user.type(nameInput, 'Jane');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        customerId: 'customer-1',
        name: 'Jane',
        email: 'test@example.com',
        locale: 'en',
      });
    });
  });

  it('shows error toast on failure', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error'));

    const onOpenChange = vi.fn();
    const { user } = render(
      <CustomerEditDialog
        customer={makeCustomer({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);
    await user.type(nameInput, 'Jane');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
