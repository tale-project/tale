// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

// The dialog's user-facing duplicate-name handling (a AppError with code
// `DUPLICATE_PRODUCT_NAME` → the `create.toast.duplicateName` toast) is what we
// verify here; the backend uniqueness rule is covered separately by
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

// The image field uploads to Convex storage (needs a ConvexProvider); stub the
// upload hook so the field renders inertly in the wizard's first step.
vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({
    uploadImage: vi.fn(),
    isUploading: false,
  }),
}));

// createProduct is a Convex mutation; replace it with a spy whose behavior each
// test sets via `mockMutate.mockImplementation`.
const mockMutate = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useCreateProduct: () => ({ mutate: mockMutate, isPending: false }),
}));

import { ProductCreateDialog } from './product-create-dialog';

const toastMock = vi.mocked(toast);

function renderDialog() {
  return render(
    <ProductCreateDialog
      isOpen={true}
      onClose={vi.fn()}
      organizationId="org-1"
    />,
  );
}

// Walk the 3-step wizard (Basics → Pricing → Review) and click Create.
async function submitWizard(user: ReturnType<typeof renderDialog>['user']) {
  await user.type(
    screen.getByLabelText('products.edit.labels.name', { exact: false }),
    'Widget',
  );
  // Next (Basics → Pricing), Next (Pricing → Review), then Create on Review.
  await user.click(screen.getByRole('button', { name: 'common.actions.next' }));
  await user.click(screen.getByRole('button', { name: 'common.actions.next' }));
  await user.click(
    screen.getByRole('button', { name: 'common.actions.create' }),
  );
}

describe('ProductCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the duplicate-name toast when create rejects with DUPLICATE_PRODUCT_NAME', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onError(new AppError({ code: 'DUPLICATE_PRODUCT_NAME' }));
    });

    const { user } = renderDialog();
    await submitWizard(user);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'products.create.toast.duplicateName',
        variant: 'destructive',
      }),
    );
  });

  it('shows the generic error toast for any other failure', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onError(new Error('network down'));
    });

    const { user } = renderDialog();
    await submitWizard(user);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'products.create.toast.error',
        variant: 'destructive',
      }),
    );
  });

  /** The door's currency rule, mirrored: any three characters used to pass
   * the dialog and be refused (or, before, stored) by the platform. */
  it('refuses a currency that is not an ISO 4217 code and sends a valid one uppercase', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });

    const { user } = renderDialog();
    await user.type(
      screen.getByLabelText('products.edit.labels.name', { exact: false }),
      'Widget',
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    const currency = screen.getByLabelText('products.edit.labels.currency', {
      exact: false,
    });
    await user.clear(currency);
    await user.type(currency, 'zzz');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.create' }),
    );
    expect(mockMutate).not.toHaveBeenCalled();

    // The refusal sits on the pricing step's field.
    await user.click(
      screen.getByRole('button', { name: 'common.actions.back' }),
    );
    expect(
      await screen.findByText('products.edit.validation.currency'),
    ).toBeInTheDocument();
    const again = screen.getByLabelText('products.edit.labels.currency', {
      exact: false,
    });
    await user.clear(again);
    await user.type(again, 'eur');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.create' }),
    );
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ currency: 'EUR' });
  });
});
