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

// #2802: an empty catalog has nothing to search, while a search that found
// nothing keeps its box, so the query can be cleared.
describe('VendorPickerPane search', () => {
  const searchBox = () =>
    screen.getByRole('textbox', { name: props.searchPlaceholder });

  it('leaves the search out when the catalog is empty and offers no custom entry', () => {
    render(<VendorPickerPane {...props} catalogLoading={false} />);

    expect(
      screen.queryByRole('textbox', { name: props.searchPlaceholder }),
    ).not.toBeInTheDocument();
  });

  it('disables the search over an empty catalog beside the custom entry', () => {
    const withCustom = {
      ...adapter,
      customVendor: {
        key: 'custom',
        make: () => ({
          key: 'custom',
          displayName: 'Custom endpoint',
          needsEndpoint: false as const,
        }),
      },
    };
    render(
      <VendorPickerPane
        {...props}
        adapter={withCustom}
        catalogLoading={false}
      />,
    );

    expect(screen.getByText(props.catalogEmpty)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Custom endpoint' }),
    ).toBeEnabled();
    expect(searchBox()).toBeDisabled();
  });

  it('keeps the search usable when it found nothing, so it can be cleared', async () => {
    const { user } = render(
      <VendorPickerPane
        {...props}
        vendors={[
          { key: 'openai', displayName: 'OpenAI', needsEndpoint: false },
        ]}
        catalogLoading={false}
      />,
    );

    await user.type(searchBox(), 'no such provider');
    expect(screen.getByText('Nothing matches that search.')).toBeVisible();
    // Judged after focus leaves: a focused box never turns disabled.
    await user.click(document.body);
    expect(searchBox()).toBeEnabled();

    // Readonly until focused again (anti-autofill): click to focus it first.
    await user.click(searchBox());
    await user.clear(searchBox());
    expect(screen.getByRole('button', { name: 'OpenAI' })).toBeVisible();
  });
});
