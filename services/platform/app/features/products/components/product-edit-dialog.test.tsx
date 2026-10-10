// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

// Verifies the user-facing half of the duplicate-name fix in the edit flow: a
// AppError with code `DUPLICATE_PRODUCT_NAME` surfaces as a field error on
// the name input (not a toast). The backend rule itself is covered by
// `assert_unique_product_name.test.ts`.

vi.mock('@tale/ui/i18n/client', () => ({
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

vi.mock('@tale/ui/use-toast', () => ({
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
  // The dialog reports from the call's own promise; a test settles it
  // through `mockMutate(args, { onSuccess, onError })`.
  useUpdateProduct: () => ({
    mutateAsync: (args: unknown) =>
      new Promise((resolve, reject) => {
        mockMutate(args, { onSuccess: resolve, onError: reject });
      }),
    isPending: false,
  }),
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

  it('persists removing the image as an explicit null', async () => {
    const { user } = render(
      <ProductEditDialog
        isOpen={true}
        onClose={vi.fn()}
        product={{ ...PRODUCT, imageUrl: 'https://images.example/product.png' }}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'products.edit.removeImage' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    await waitFor(() =>
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ imageUrl: null }),
        expect.anything(),
      ),
    );
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

  /** The door's currency rule, mirrored: any three characters used to pass
   * the dialog and be refused by the platform. */
  it('refuses a currency that is not an ISO 4217 code and sends a valid one uppercase', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });

    const { user } = renderDialog();
    const currency = screen.getByLabelText('products.edit.labels.currency', {
      exact: false,
    });
    await user.clear(currency);
    await user.type(currency, 'zz');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    expect(
      await screen.findByText('products.edit.validation.currency'),
    ).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();

    await user.clear(currency);
    await user.type(currency, 'eur');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ currency: 'EUR' });
  });
});

describe('ProductEditDialog — pasted image URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A URL without a scheme passed the length-only check and came back from
  // Save as a bare `invalid body` (TALE-84).
  it('refuses an address that is not an absolute http(s) URL and saves a valid one', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });
    const { user } = renderDialog();
    await user.click(
      screen.getByRole('button', { name: 'products.edit.pasteUrl' }),
    );
    const url = screen.getByLabelText('products.edit.labels.imageUrl', {
      exact: false,
    });
    await user.type(url, 'cdn.example.com/cat.png');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );

    expect(
      await screen.findByText('products.edit.validation.imageUrl'),
    ).toBeInTheDocument();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(mockMutate).not.toHaveBeenCalled();

    await user.clear(url);
    await user.type(url, 'https://cdn.example.com/cat.png');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/cat.png',
    });
  });
});

describe('ProductEditDialog — price and stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['price', '-5', 'products.edit.validation.priceNonNegative'],
    ['stock', '1.5', 'products.edit.validation.stockInteger'],
  ])('refuses %s %s under its field on Save', async (field, value, message) => {
    const { user } = render(
      <ProductEditDialog
        isOpen={true}
        onClose={vi.fn()}
        product={{ ...PRODUCT, price: 10, stock: 1 }}
      />,
    );
    const input = screen.getByLabelText(`products.edit.labels.${field}`, {
      exact: false,
    });
    await user.clear(input);
    await user.type(input, value);
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  // `1e3` passed Save's check as 1000 and was saved as stock 1: the form
  // judged it with `Number`, the submit sent `parseInt` (#3616). A browser
  // keeps the spelling as the input's value; `user.type` would hand the form
  // `1000` instead, so the value is set the way the browser leaves it.
  it.each([
    ['stock', '1000', 1000],
    ['stock', '1e3', 1000],
    ['stock', '2.5e2', 250],
    ['price', '12.5', 12.5],
    ['price', '1.25e1', 12.5],
  ])('saves %s %s as the %d it accepted', async (field, entered, sent) => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });
    const { user } = render(
      <ProductEditDialog
        isOpen={true}
        onClose={vi.fn()}
        product={{ ...PRODUCT, price: 10, stock: 5 }}
      />,
    );
    fireEvent.change(
      screen.getByLabelText(`products.edit.labels.${field}`, {
        exact: false,
      }),
      { target: { value: entered } },
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.save' }),
    );
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ [field]: sent });
  });
});

// The session door's 401 names the REST API in English; the person whose
// session ended reads why in their own language, under the localized title.
describe.each(SHIPPED_LOCALES)(
  'ProductEditDialog after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session has ended under the save error title', async () => {
      mockMutate.mockImplementation(
        (_args, opts: { onError: (error: unknown) => void }) => {
          void lapsedSessionRefusal().catch(opts.onError);
        },
      );

      const { user } = renderDialog();
      const nameInput = screen.getByLabelText('products.edit.labels.name', {
        exact: false,
      });
      await user.clear(nameInput);
      await user.type(nameInput, 'Renamed product');
      await user.click(
        screen.getByRole('button', { name: 'common.actions.save' }),
      );

      const toastMock = vi.mocked(toast);
      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: 'products.edit.toast.error',
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(toastMock.mock.calls)).not.toContain('API key');
    });
  },
);
