/**
 * The stock each product dialog sends over the real write path:
 * `useCreateProduct` and `useUpdateProduct`, `useBackendMutation`, the
 * `products/mutations:*` adapter rows and `backendFetch` run unchanged, and
 * only `fetch` is answered here, so each assertion reads the body the door
 * receives.
 *
 * #3616: a stock of `1e3` passed the form as 1000 and went out as 1. A browser
 * keeps the spelling as the input's value (`user.type` would hand the form
 * `1000`), so the value is set the way the browser leaves it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { ProductCreateDialog } from './product-create-dialog';
import { ProductEditDialog } from './product-edit-dialog';

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: vi.fn(),
}));
// FormDialog reads the org id from the router for its error boundary.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// Nothing here uploads; the image field's upload hook needs a backend.
vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_ACCEPT: 'image/*',
  PRODUCT_IMAGE_MAX_BYTES: 5_000_000,
  useProductImageUpload: () => ({ uploadImage: vi.fn(), isUploading: false }),
}));

const CREATE_URL = '/api/app/products?orgId=org-1';
const UPDATE_URL = '/api/app/products/prod-1?orgId=org-1';

/** The writes the product doors received, in order. */
let sent: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  sent = [];
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', '/dashboard/org-1/products');
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (
      (url === CREATE_URL || url === UPDATE_URL) &&
      init?.method === 'POST' &&
      typeof init.body === 'string'
    ) {
      sent.push({ url, body: JSON.parse(init.body) });
      return Response.json(
        url === CREATE_URL ? { productId: 'prod-1' } : { ok: true },
      );
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('product stock over the real write path', () => {
  it.each(['1000', '1e3'])(
    'creates stock %s as 1000 in the body',
    async (entered) => {
      const onClose = vi.fn();
      const { user } = render(
        <QueryClientProvider client={new QueryClient()}>
          <ProductCreateDialog
            isOpen
            onClose={onClose}
            organizationId="org-1"
          />
        </QueryClientProvider>,
      );
      const dialog = screen.getByRole('dialog', { name: 'Add product' });
      await user.type(
        within(dialog).getByLabelText(/^Product name/),
        'Audit widget',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Next' }));
      fireEvent.change(within(dialog).getByLabelText(/^Stock/), {
        target: { value: entered },
      });
      await user.click(within(dialog).getByRole('button', { name: 'Next' }));
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(sent).toEqual([
        {
          url: CREATE_URL,
          body: expect.objectContaining({ stock: 1000 }),
        },
      ]);
    },
  );

  it.each(['1000', '1e3'])(
    'saves stock %s as 1000 in the body',
    async (entered) => {
      const onClose = vi.fn();
      const { user } = render(
        <QueryClientProvider client={new QueryClient()}>
          <ProductEditDialog
            isOpen
            onClose={onClose}
            product={{
              _id: 'prod-1',
              organizationId: 'org-1',
              name: 'Audit widget',
              stock: 5,
              status: 'active',
            }}
          />
        </QueryClientProvider>,
      );
      const dialog = screen.getByRole('dialog', { name: 'Edit product' });
      fireEvent.change(within(dialog).getByLabelText(/^Stock/), {
        target: { value: entered },
      });
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(sent).toEqual([
        {
          url: UPDATE_URL,
          body: expect.objectContaining({ stock: 1000 }),
        },
      ]);
    },
  );
});
