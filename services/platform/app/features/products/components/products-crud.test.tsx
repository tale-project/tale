import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

// Migrated from the knowledge E2E "creates, edits and deletes a products
// entity". That spec drove three pure client-side flows against the shared
// DataTable: the create *wizard* (basics -> pricing -> review, gated on the
// name), the row-action -> Edit dialog (prefilled, rename, Save), and the
// row-action -> Delete confirm dialog. The only backend seams are the
// create/update/delete mutations, which we mock by their real hook names; the
// vendors round-trip e2e still proves real persistence end-to-end. Everything
// asserted here — wizard step gating, the prefilled edit value, and the delete
// confirmation firing the mutation — is rendered UI / client logic, so it
// belongs at the component tier.

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeleteAsync = vi.fn().mockResolvedValue(undefined);

// The create dialog uses `mutate(args, { onSuccess, onError })`; invoke the
// success callback so the dialog's close path runs exactly as in the app.
vi.mock('../hooks/mutations', () => ({
  useCreateProduct: () => ({
    mutate: (
      args: unknown,
      cbs?: { onSuccess?: () => void; onError?: (e: unknown) => void },
    ) => {
      mockCreate(args);
      cbs?.onSuccess?.();
    },
    isPending: false,
  }),
  useUpdateProduct: () => ({
    mutate: (
      args: unknown,
      cbs?: { onSuccess?: () => void; onError?: (e: unknown) => void },
    ) => {
      mockUpdate(args);
      cbs?.onSuccess?.();
    },
    isPending: false,
  }),
  useDeleteProduct: () => ({ mutateAsync: mockDeleteAsync }),
}));

// The image field uploads via the Convex client; component tier has no backend.
vi.mock('../hooks/use-product-image-upload', () => ({
  PRODUCT_IMAGE_MAX_BYTES: 5 * 1024 * 1024,
  PRODUCT_IMAGE_ACCEPT: 'image/png,image/jpeg',
  useProductImageUpload: () => ({
    uploadImage: vi.fn().mockResolvedValue(null),
    isUploading: false,
  }),
}));

// Row actions only render for a writer; the edit dialog reads the org id from
// the router for its error boundary.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

import { ProductCreateDialog } from './product-create-dialog';
import { ProductRowActions } from './product-row-actions';
import { ProductStatusBadge } from './product-status-badge';

// Doc<'products'> shape the row/edit dialog reads. Cast the branded Id via
// `unknown` so the fixture stays a plain object.
const product = {
  _id: 'product-1' as never,
  _creationTime: Date.now(),
  organizationId: 'org-1',
  name: 'Acme Widget',
  description: 'A test product',
  price: 19.99,
  currency: 'USD',
  source: 'manual_import' as const,
  locale: 'en',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Product create wizard', () => {
  it('walks basics -> pricing -> review and creates the product', async () => {
    const onClose = vi.fn();
    const { user, container } = render(
      <ProductCreateDialog isOpen onClose={onClose} organizationId="org-1" />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    expect(dialog).toBeInTheDocument();

    // Step 1 (basics): Next is gated on the name. Empty name -> disabled.
    const next = () => within(dialog).getByRole('button', { name: 'Next' });
    expect(next()).toBeDisabled();

    await checkAccessibility(container);

    await user.type(
      // The required `*` carries an aria-label, so the field's accessible name
      // is "Product name Required" — match the leading label substring.
      within(dialog).getByLabelText(/Product name/),
      'Acme Widget',
    );
    expect(next()).toBeEnabled();

    // basics -> pricing
    await user.click(next());
    // The pricing step exposes the Price field; the review step doesn't.
    expect(within(dialog).getByLabelText('Price')).toBeInTheDocument();

    // pricing -> review
    await user.click(next());
    // The review step echoes the typed name; the wizard footer now shows
    // "Create" in place of "Next".
    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeInTheDocument();
    expect(within(dialog).getAllByText('Acme Widget').length).toBeGreaterThan(
      0,
    );

    await user.click(create);

    // Create mutation fires with the trimmed name; success closes the dialog.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', name: 'Acme Widget' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(
      <ProductCreateDialog
        isOpen={false}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Product row actions: edit', () => {
  it('opens the prefilled edit dialog, renames, and saves', async () => {
    const { user } = render(<ProductRowActions product={product} />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog', { name: 'Edit product' });
    const nameField = within(dialog).getByLabelText(/Product name/);
    // Prefilled with the existing name — the E2E asserted toHaveValue(name).
    expect(nameField).toHaveValue('Acme Widget');

    await user.clear(nameField);
    await user.type(nameField, 'Acme Widget edited');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'product-1',
        name: 'Acme Widget edited',
      }),
    );
  });
});

describe('Product row actions: delete', () => {
  it('opens the delete confirm dialog and fires the delete on confirm', async () => {
    const { user } = render(<ProductRowActions product={product} />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete product' });
    expect(
      within(dialog).getByText(/Delete "Acme Widget"\?/),
    ).toBeInTheDocument();
    await checkAccessibility(dialog);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync).toHaveBeenCalledWith({ productId: 'product-1' });
  });
});

// Regression for #2052 [71]: the products table Status column and the view
// dialog used to render the raw backend enum (`active`, `draft`, …) with a
// `capitalize` class. The shared badge now resolves the value through the
// `common.status.<key>` keys and falls back to the raw value for unknown ones.
describe('ProductStatusBadge', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<ProductStatusBadge status="active" />);
      await checkAccessibility(container);
    });
  });

  it('renders the localized label with the blue variant for active', () => {
    render(<ProductStatusBadge status="active" />);

    const badge = screen.getByText('Active');
    expect(badge).toBeInTheDocument();
    // `active` -> `blue` variant.
    expect(badge.closest('[title="Active"]')).toHaveClass('bg-blue-100');
  });

  it('renders the localized label with the outline variant for a non-active status', () => {
    render(<ProductStatusBadge status="draft" />);

    const badge = screen.getByText('Draft');
    expect(badge).toBeInTheDocument();
    const wrapper = badge.closest('[title="Draft"]');
    // Non-active -> default `outline` variant, not the blue active style.
    expect(wrapper).toHaveClass('border');
    expect(wrapper).not.toHaveClass('bg-blue-100');
  });

  it('falls back to the raw value for an unknown status', () => {
    render(<ProductStatusBadge status="mystery" />);

    // No translation key -> raw value rendered, no `status.*` key leak.
    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(screen.queryByText('status.mystery')).not.toBeInTheDocument();
  });
});
