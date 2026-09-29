import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import type {
  CredentialAdapter,
  CredentialLike,
  CredentialVendor,
} from './adapter';
import { CredentialEditDialog } from './credential-edit-dialog';

/**
 * The edit dialog stays mounted with its table row, so what it shows when it
 * opens must be the credential as the listing holds it then — and so must
 * the version an extra carries into the save (a custom provider's reviewed
 * hashes), or a dialog opened after someone else's save would save against
 * a version older than the values on screen.
 */

const update = vi.hoisted(() => vi.fn());

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

interface VersionedCredential extends CredentialLike {
  version: string;
}

const vendor: CredentialVendor = {
  key: 'gateway',
  displayName: 'Gateway',
  needsEndpoint: false,
};

const noop = { mutateAsync: vi.fn(), isPending: false };
const adapter = {
  logTag: 'test',
  mapError: () => 'refused',
  endpointField: () => ({ label: 'Endpoint' }),
  extra: {
    empty: () => ({ version: '' }),
    fromCredential: (credential: VersionedCredential) => ({
      version: credential.version,
    }),
    isDirty: () => false,
    createArgs: () => ({}),
    editArgs: (value: { version: string }) => ({ reviewed: value.version }),
    Fields: null,
  },
  mutations: {
    useCreate: () => noop,
    useUpdate: () => ({ mutateAsync: update, isPending: false }),
    useDelete: () => noop,
    useSetDefault: () => noop,
  },
} as unknown as CredentialAdapter<
  CredentialVendor,
  VersionedCredential,
  string,
  unknown,
  { version: string }
>;

const credential = (name: string, version: string): VersionedCredential => ({
  id: 'c1',
  name,
  version,
  authMethod: 'env',
  status: 'active',
  isDefault: true,
});

const dialog = (props: { credential: VersionedCredential; open: boolean }) => (
  <CredentialEditDialog
    organizationId="org-1"
    vendor={vendor}
    adapter={adapter}
    onOpenChange={() => {}}
    {...props}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue(null);
});

describe('CredentialEditDialog', () => {
  it('seeds the form from the credential as it is when the dialog opens', async () => {
    const { rerender, user } = render(
      dialog({ credential: credential('Gateway A', 'v1'), open: false }),
    );
    // Another session renamed the credential while the dialog was closed.
    rerender(dialog({ credential: credential('Gateway B', 'v2'), open: true }));

    const form = within(
      await screen.findByRole('dialog', { name: 'Edit credential' }),
    );
    const name = form.getByRole('textbox', { name: /^Name/ });
    expect(name).toHaveValue('Gateway B');
    await user.clear(name);
    await user.type(name, 'Gateway C');
    await user.click(form.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialId: 'c1',
        name: 'Gateway C',
        reviewed: 'v2',
      }),
    );
  });

  it('keeps what the reader typed while the dialog stays open', async () => {
    const { rerender, user } = render(
      dialog({ credential: credential('Gateway A', 'v1'), open: true }),
    );
    const form = within(
      await screen.findByRole('dialog', { name: 'Edit credential' }),
    );
    const name = form.getByRole('textbox', { name: /^Name/ });
    await user.clear(name);
    await user.type(name, 'Gateway typed');
    // The listing refetches under the open dialog.
    rerender(dialog({ credential: credential('Gateway B', 'v2'), open: true }));

    expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
      'Gateway typed',
    );
    await user.click(form.getByRole('button', { name: 'Save' }));
    // The save names the version the form was seeded at, not the newer one.
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Gateway typed', reviewed: 'v1' }),
      ),
    );
  });
});
