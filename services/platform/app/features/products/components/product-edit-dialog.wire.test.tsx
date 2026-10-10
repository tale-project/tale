/**
 * The edit dialog's Save over the real write path: `useUpdateProduct`,
 * `useBackendMutation`, the `products/mutations:updateProduct` adapter row and
 * `backendFetch` run unchanged, and only `fetch` is answered here, so each
 * assertion reads the body the update door receives. The door's patch rule
 * (`ProductInput`): an omitted key is "unchanged", `null` clears it.
 *
 * #3615: an emptied description, category, price, currency or stock went out
 * as `undefined`, the adapter dropped the key, and the door kept the old value
 * behind the success toast.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProductEditDialog } from './product-edit-dialog';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
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

const STORED = {
  _id: 'prod-1',
  organizationId: 'org-1',
  name: 'Audit widget',
  description: 'Old description',
  category: 'Old category',
  price: 12.5,
  currency: 'CHF',
  stock: 8,
  status: 'active' as const,
};

/** A product with only its name and status set. */
const BARE = {
  _id: 'prod-1',
  organizationId: 'org-1',
  name: 'Audit widget',
  status: 'active' as const,
};

/** The five optional fields the card names, by their English labels. */
const OPTIONAL = ['Description', 'Category', 'Price', 'Currency', 'Stock'];

/** The bodies the update door received, in order. */
let sent: unknown[] = [];

beforeEach(() => {
  sent = [];
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', '/dashboard/org-1/products');
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (
      url === '/api/app/products/prod-1?orgId=org-1' &&
      init?.method === 'POST' &&
      typeof init.body === 'string'
    ) {
      sent.push(JSON.parse(init.body));
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  toast.mockReset();
});

function renderDialog(product: object) {
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ProductEditDialog
        isOpen
        onClose={onClose}
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the door's row: a cleared field reads back as null
        product={product as typeof STORED}
      />
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Edit product' });
  const field = (label: string) =>
    within(dialog).getByLabelText(new RegExp(`^${label}`));
  const save = () =>
    view.user.click(within(dialog).getByRole('button', { name: 'Save' }));
  return { ...view, onClose, field, save };
}

describe('ProductEditDialog — Save over the real write path', () => {
  it('sends every emptied optional field as null, then closes on success', async () => {
    const { user, field, save, onClose } = renderDialog(STORED);
    for (const label of OPTIONAL) {
      await user.clear(field(label));
    }
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      {
        name: 'Audit widget',
        description: null,
        imageUrl: null,
        stock: null,
        price: null,
        currency: null,
        category: null,
        status: 'active',
      },
    ]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Product updated', variant: 'success' }),
    );
  });

  it('clears one emptied field and keeps the rest as they were', async () => {
    const { user, field, save, onClose } = renderDialog(STORED);
    await user.clear(field('Stock'));
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      {
        name: 'Audit widget',
        description: 'Old description',
        imageUrl: null,
        stock: null,
        price: 12.5,
        currency: 'CHF',
        category: 'Old category',
        status: 'active',
      },
    ]);
  });

  // The controls: a field that opened blank and stays blank is not a change,
  // so it stays out of the patch (a currency that opened blank used to go out
  // as USD), and zero is a value, not a blank.
  it('leaves a field that opened blank out of the patch', async () => {
    const { user, field, save, onClose } = renderDialog(BARE);
    await user.clear(field('Product name'));
    await user.type(field('Product name'), 'Renamed widget');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      { name: 'Renamed widget', imageUrl: null, status: 'active' },
    ]);
  });

  it('still sends a price and a stock of zero', async () => {
    const { user, field, save, onClose } = renderDialog(STORED);
    await user.clear(field('Price'));
    await user.type(field('Price'), '0');
    await user.clear(field('Stock'));
    await user.type(field('Stock'), '0');
    await save();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([expect.objectContaining({ price: 0, stock: 0 })]);
  });

  it('reopens a cleared product with every emptied field blank', () => {
    const { field } = renderDialog({
      ...STORED,
      description: null,
      category: null,
      price: null,
      currency: null,
      stock: null,
    });
    expect(field('Description')).toHaveValue('');
    expect(field('Category')).toHaveValue('');
    expect(field('Currency')).toHaveValue('');
    expect(field('Price')).toHaveValue(null);
    expect(field('Stock')).toHaveValue(null);
  });
});
