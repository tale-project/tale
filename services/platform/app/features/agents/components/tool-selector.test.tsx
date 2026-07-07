import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ToolSelector } from './tool-selector';

// The picker is pure client-side UI over three catalog queries — mock them
// with a small fixed tool set spanning three categories so grouping, counts,
// search, and the enable-all semantics are all exercised.
vi.mock('../hooks/queries', () => ({
  useAvailableTools: () => ({
    tools: [
      { name: 'customer_read', available: true },
      { name: 'customer_write', available: true },
      { name: 'product_read', available: true },
      { name: 'product_write', available: true },
      { name: 'run_code', available: true },
    ],
    isLoading: false,
  }),
  useAvailableIntegrations: () => ({ integrations: [], isLoading: false }),
  useAvailableWorkflows: () => ({ workflows: [], isLoading: false }),
}));

// Resolved from messages/en.json — settings.agents.tools.* and chat.tools.*.
const CUSTOMERS_GROUP = 'Customers';
const PRODUCTS_GROUP = 'Products';
const SYSTEM_GROUP = 'System';
const CUSTOMER_READ = 'Customer data';
const CUSTOMER_WRITE = 'Update customer';
const PRODUCT_READ = 'Product catalog';
const RUN_CODE = 'Run code';
const CUSTOMER_READ_DESCRIPTION = 'Look up and list customer records';
const SEARCH_PLACEHOLDER = 'Search tools…';
const NO_RESULTS = 'No results found';

function renderSelector(
  props: Partial<Parameters<typeof ToolSelector>[0]> = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <ToolSelector
      value={[]}
      onChange={onChange}
      integrationBindings={[]}
      onIntegrationBindingsChange={vi.fn()}
      workflowBindings={[]}
      onWorkflowBindingsChange={vi.fn()}
      organizationId="org-1"
      {...props}
    />,
  );
  return { onChange, ...utils };
}

describe('ToolSelector', () => {
  it('groups tools by category with labels, descriptions, and counts', async () => {
    const { container } = renderSelector({ value: ['customer_read'] });

    // Category enable-all checkboxes carry the category label.
    expect(
      screen.getByRole('checkbox', { name: CUSTOMERS_GROUP }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: PRODUCTS_GROUP }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: SYSTEM_GROUP }),
    ).toBeInTheDocument();

    // Tool rows show the shared display name plus a one-line description.
    expect(screen.getByRole('checkbox', { name: CUSTOMER_READ })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: CUSTOMER_WRITE }),
    ).not.toBeChecked();
    expect(screen.getByText(CUSTOMER_READ_DESCRIPTION)).toBeInTheDocument();

    // Enabled-count badge: 1 of 2 customer tools on.
    expect(screen.getByLabelText('1 of 2 tools enabled')).toHaveTextContent(
      '1/2',
    );

    await checkAccessibility(container);
  });

  it('marks a partially enabled group indeterminate and a full group checked', () => {
    renderSelector({
      value: ['customer_read', 'product_read', 'product_write'],
    });

    expect(
      screen.getByRole('checkbox', { name: CUSTOMERS_GROUP }),
    ).toHaveAttribute('data-state', 'indeterminate');
    expect(
      screen.getByRole('checkbox', { name: PRODUCTS_GROUP }),
    ).toHaveAttribute('data-state', 'checked');
    expect(
      screen.getByRole('checkbox', { name: SYSTEM_GROUP }),
    ).toHaveAttribute('data-state', 'unchecked');
  });

  it('toggling one tool preserves selections in other groups', async () => {
    const { onChange, user } = renderSelector({ value: ['customer_read'] });

    await user.click(screen.getByRole('checkbox', { name: PRODUCT_READ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sort()).toEqual([
      'customer_read',
      'product_read',
    ]);
  });

  it('group enable-all selects every tool in the group, and clears when full', async () => {
    const { onChange, user, unmount } = renderSelector({
      value: ['customer_read'],
    });

    // Indeterminate → click selects the rest of the group.
    await user.click(screen.getByRole('checkbox', { name: CUSTOMERS_GROUP }));
    expect(onChange.mock.calls[0][0].sort()).toEqual([
      'customer_read',
      'customer_write',
    ]);
    unmount();

    const { onChange: onChange2, user: user2 } = renderSelector({
      value: ['customer_read', 'customer_write'],
    });

    // Fully selected → click clears the group.
    await user2.click(screen.getByRole('checkbox', { name: CUSTOMERS_GROUP }));
    expect(onChange2.mock.calls[0][0]).toEqual([]);
  });

  it('filters tools and groups by search query', async () => {
    const { user } = renderSelector();

    await user.type(
      screen.getByPlaceholderText(SEARCH_PLACEHOLDER),
      'customer',
    );

    // Customer tools stay; unrelated groups disappear.
    expect(
      screen.getByRole('checkbox', { name: CUSTOMER_READ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: PRODUCT_READ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: SYSTEM_GROUP }),
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when no tool matches the query', async () => {
    const { user } = renderSelector();

    await user.type(
      screen.getByPlaceholderText(SEARCH_PLACEHOLDER),
      'zzzznotool',
    );

    expect(screen.getByText(NO_RESULTS)).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: CUSTOMER_READ }),
    ).not.toBeInTheDocument();
  });

  it('excludes hidden tools from the picker', () => {
    renderSelector({ hiddenTools: new Set(['run_code']) });

    expect(
      screen.queryByRole('checkbox', { name: RUN_CODE }),
    ).not.toBeInTheDocument();
    // The rest of the catalog still renders.
    expect(
      screen.getByRole('checkbox', { name: CUSTOMER_READ }),
    ).toBeInTheDocument();
  });

  it('hides the platform-tool catalog for external agents', () => {
    renderSelector({ showPlatformTools: false, showWorkflows: false });

    expect(
      screen.queryByPlaceholderText(SEARCH_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: CUSTOMER_READ }),
    ).not.toBeInTheDocument();
    // Integration bindings (the external agent's MCP grant set) stay.
    expect(screen.getByText('Bound integrations')).toBeInTheDocument();
  });
});
