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
import { render, screen, waitFor } from '@/tests/utils/render';

// The dialog's user-facing duplicate-name handling (a AppError with code
// `DUPLICATE_PRODUCT_NAME` → the `create.toast.duplicateName` toast) is what we
// verify here; the backend uniqueness rule is covered separately by
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
  // The dialog reports from the call's own promise; a test settles it
  // through `mockMutate(args, { onSuccess, onError })`.
  useCreateProduct: () => ({
    mutateAsync: (args: unknown) =>
      new Promise((resolve, reject) => {
        mockMutate(args, { onSuccess: resolve, onError: reject });
      }),
    isPending: false,
  }),
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

  // Regression (2026-09-26 evaluation, B-04): a refused body reached the
  // user as "Couldn't create product" with no field named.
  it('puts the refused field under the error toast', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onError(
        new AppError({
          code: 'invalid body',
          message:
            'price: Number must be less than or equal to 9007199254740991',
          data: { issues: [{ path: 'price', message: 'too large' }] },
        }),
      );
    });

    const { user } = renderDialog();
    await submitWizard(user);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'products.create.toast.error',
          description:
            'price: Number must be less than or equal to 9007199254740991',
          variant: 'destructive',
        }),
      );
    });
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
    // The step refuses to advance and names the field; Review is never shown.
    expect(
      await screen.findByText('products.edit.validation.currency'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'common.actions.create' }),
    ).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
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

describe('ProductCreateDialog — price and stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function toPricing(user: ReturnType<typeof renderDialog>['user']) {
    await user.type(
      screen.getByLabelText('products.edit.labels.name', { exact: false }),
      'Widget',
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
  }

  // A negative price and stock used to reach Review and be created; an
  // amount past the safe range failed after Create as a bare toast.
  it.each([
    ['price', '-5', 'products.edit.validation.priceNonNegative'],
    ['price', '1e20', 'products.edit.validation.priceTooLarge'],
    ['stock', '-3', 'products.edit.validation.stockNonNegative'],
    ['stock', '1.5', 'products.edit.validation.stockInteger'],
    ['stock', '99999999999999999999', 'products.edit.validation.stockTooLarge'],
  ])(
    'refuses %s %s at the Pricing step with a field error',
    async (field, value, message) => {
      const { user } = renderDialog();
      await toPricing(user);
      await user.type(
        screen.getByLabelText(`products.edit.labels.${field}`, {
          exact: false,
        }),
        value,
      );
      await user.click(
        screen.getByRole('button', { name: 'common.actions.next' }),
      );
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'common.actions.create' }),
      ).not.toBeInTheDocument();
      expect(mockMutate).not.toHaveBeenCalled();
    },
  );

  it('sends a valid price and stock as numbers', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });
    const { user } = renderDialog();
    await toPricing(user);
    await user.type(
      screen.getByLabelText('products.edit.labels.price', { exact: false }),
      '12.5',
    );
    await user.type(
      screen.getByLabelText('products.edit.labels.stock', { exact: false }),
      '3',
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.create' }),
    );
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1));
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      price: 12.5,
      stock: 3,
    });
  });
});

// The session door's 401 names the REST API in English; the person whose
// session ended reads why in their own language, under the localized title.
describe.each(SHIPPED_LOCALES)(
  'ProductCreateDialog after a lapsed session (%s)',
  (locale) => {
    beforeEach(() => {
      vi.clearAllMocks();
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session has ended under the create error title', async () => {
      mockMutate.mockImplementation(
        (_args, opts: { onError: (error: unknown) => void }) => {
          void lapsedSessionRefusal().catch(opts.onError);
        },
      );

      const { user } = renderDialog();
      await submitWizard(user);

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: 'products.create.toast.error',
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(toastMock.mock.calls)).not.toContain('API key');
    });
  },
);

describe('ProductCreateDialog — pasted image URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function pasteImageUrl(
    user: ReturnType<typeof renderDialog>['user'],
    value: string,
  ) {
    await user.type(
      screen.getByLabelText('products.edit.labels.name', { exact: false }),
      'Widget',
    );
    await user.click(
      screen.getByRole('button', { name: 'products.edit.pasteUrl' }),
    );
    const url = screen.getByLabelText('products.edit.labels.imageUrl', {
      exact: false,
    });
    await user.type(url, value);
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    return url;
  }

  // A URL without a scheme passed the length-only check, reached Review and
  // came back from Create as a bare `invalid body` (TALE-84).
  it('refuses an address that is not an absolute http(s) URL at the Basics step', async () => {
    const { user } = renderDialog();
    const url = await pasteImageUrl(user, 'example.com/cat.png');

    expect(
      await screen.findByText('products.edit.validation.imageUrl'),
    ).toBeInTheDocument();
    // Named under the field it was typed into.
    expect(url).toHaveAttribute('aria-invalid', 'true');
    // The step refuses to advance: Pricing is never shown.
    expect(
      screen.queryByLabelText('products.edit.labels.price', { exact: false }),
    ).not.toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('sends an absolute URL trimmed', async () => {
    mockMutate.mockImplementation((_args, opts) => {
      opts.onSuccess();
    });
    const { user } = renderDialog();
    await pasteImageUrl(user, ' https://cdn.example.com/cat.png ');
    await user.click(
      screen.getByRole('button', { name: 'common.actions.next' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'common.actions.create' }),
    );

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledTimes(1);
    });
    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/cat.png',
    });
  });
});
