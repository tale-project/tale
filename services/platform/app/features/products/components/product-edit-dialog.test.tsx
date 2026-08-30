// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

// Verifies the user-facing half of the duplicate-name fix in the edit flow: a
// AppError with code `DUPLICATE_PRODUCT_NAME` surfaces as a field error on
// the name input (not a toast). The backend rule itself is covered by
// `assert_unique_product_name.test.ts`.

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

// FormDialog reads the org id from the router for its error boundary; outside a
// RouterProvider that hook throws, so stub it like the other dialog tests do.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({
    uploadImage: vi.fn(),
    isUploading: false,
  }),
}));

const mockMutate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useUpdateProduct: () => ({ mutate: mockMutate, isPending: false }),
}));

import { ProductEditDialog } from './product-edit-dialog';

const PRODUCT = {
  _id: 'prod-1' as string,
  organizationId: 'org-1',
  name: 'Original name',
  status: 'active' as const,
};

function renderDialog(product: typeof PRODUCT = PRODUCT) {
  return render(
    <ProductEditDialog isOpen={true} onClose={vi.fn()} product={product} />,
  );
}

describe('ProductEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets a name field error when update rejects with DUPLICATE_PRODUCT_NAME', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onError(new AppError({ code: 'DUPLICATE_PRODUCT_NAME' }));
    });

    const { user } = renderDialog();

    // Rename to (a presumed) duplicate. Editing dirties the form, enabling Save.
    const nameInput = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    await user.clear(nameInput);
    await user.type(nameInput, 'Existing product');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    // The duplicate is reported inline on the name field, not as a toast.
    await waitFor(() => {
      expect(
        screen.getByText('products.edit.toast.duplicateName'),
      ).toBeInTheDocument();
    });
  });

  it('keeps the duplicate-name error and typed name across the optimistic update + rollback', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onError(new AppError({ code: 'DUPLICATE_PRODUCT_NAME' }));
    });

    const { user, rerender } = renderDialog();

    const nameInput = screen.getByLabelText('products.edit.labels.name', {
      exact: false,
    });
    await user.clear(nameInput);
    await user.type(nameInput, 'Existing product');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );

    await waitFor(() => {
      expect(
        screen.getByText('products.edit.toast.duplicateName'),
      ).toBeInTheDocument();
    });

    // The real `useUpdateProduct` optimistic update patches the cached product's
    // name to the submitted value, then rolls it back when the server rejects.
    // Each of those is a new `product` prop identity; the dialog must NOT reset
    // the form (which would clear the field error and revert the typed name).
    rerender(
      <ProductEditDialog
        isOpen={true}
        onClose={vi.fn()}
        product={{ ...PRODUCT, name: 'Existing product' }}
      />,
    );
    rerender(
      <ProductEditDialog isOpen={true} onClose={vi.fn()} product={PRODUCT} />,
    );

    // Error survives and the user's input is preserved (not reverted).
    expect(
      screen.getByText('products.edit.toast.duplicateName'),
    ).toBeInTheDocument();
    expect(nameInput).toHaveValue('Existing product');
  });
});
