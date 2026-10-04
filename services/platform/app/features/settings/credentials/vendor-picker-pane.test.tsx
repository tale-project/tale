import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { CredentialAdapter } from './adapter';
import { VendorPickerPane } from './vendor-picker-pane';

type Vendor = {
  key: string;
  displayName: string;
  needsEndpoint: false;
};

type Credential = {
  id: string;
  name: string;
  authMethod: string;
  status: string;
  isDefault: boolean;
};

const adapter = {
  formMethods: () => ['api-key'],
  vendorMeta: () => null,
  secret: { empty: '' },
  extra: { empty: {} },
  mutations: {
    useCreate: () => ({ mutateAsync: async () => {}, isPending: false }),
    useUpdate: () => ({ mutateAsync: async () => {}, isPending: false }),
    useDelete: () => ({ mutateAsync: async () => {}, isPending: false }),
    useSetDefault: () => ({ mutateAsync: async () => {}, isPending: false }),
  },
} as unknown as CredentialAdapter<
  Vendor,
  Credential,
  'api-key',
  string,
  object
>;

const props = {
  vendors: [],
  inUseKeys: new Set<string>(),
  adapter,
  onSelect: () => {},
  searchPlaceholder: 'Search providers',
  catalogEmpty: 'No provider files',
};

describe('VendorPickerPane catalog state', () => {
  it('shows an accessible loading state instead of the empty catalog warning', () => {
    render(<VendorPickerPane {...props} catalogLoading />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(props.catalogEmpty)).not.toBeInTheDocument();
  });

  it('keeps the deployment warning after an empty catalog succeeds', () => {
    render(<VendorPickerPane {...props} catalogLoading={false} />);

    expect(screen.getByText(props.catalogEmpty)).toBeInTheDocument();
  });
});
