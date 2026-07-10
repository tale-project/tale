import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ToolSelector } from './tool-selector';

// The picker is pure client-side UI over three catalog queries — mock them
// with a small fixed tool set spanning three categories so grouping, counts,
// search, and the enable-all semantics are all exercised.
// `mockAvailableWorkflows` (the `mock`-prefix is required for Vitest's
// hoisting to let the factory below reference it) lets individual tests
// override the binding list; every other test gets the empty default.
const mockAvailableWorkflows = vi.fn(() => ({
  workflows: [] as unknown[],
  isLoading: false,
}));
vi.mock('../hooks/queries', () => ({
  useAvailableTools: () => ({
    tools: [
      { name: 'contact_read', available: true },
      { name: 'contact_write', available: true },
      { name: 'product_read', available: true },
      { name: 'product_write', available: true },
      { name: 'run_code', available: true },
    ],
    isLoading: false,
  }),
  useAvailableIntegrations: () => ({ integrations: [], isLoading: false }),
  useAvailableWorkflows: () => mockAvailableWorkflows(),
}));

// Resolved from messages/en.json — settings.agents.tools.* and chat.tools.*.
const CONTACTS_GROUP = 'Contacts';
const PRODUCTS_GROUP = 'Products';
const SYSTEM_GROUP = 'System';
const CONTACT_READ = 'Contact data';
const CONTACT_WRITE = 'Update contact';
const PRODUCT_READ = 'Product catalog';
const RUN_CODE = 'Run code';
const CONTACT_READ_DESCRIPTION = 'Look up and list contact records';
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
    const { container } = renderSelector({ value: ['contact_read'] });

    // Category enable-all checkboxes carry the category label.
    expect(
      screen.getByRole('checkbox', { name: CONTACTS_GROUP }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: PRODUCTS_GROUP }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: SYSTEM_GROUP }),
    ).toBeInTheDocument();

    // Tool rows show the shared display name plus a one-line description.
    expect(screen.getByRole('checkbox', { name: CONTACT_READ })).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: CONTACT_WRITE }),
    ).not.toBeChecked();
    expect(screen.getByText(CONTACT_READ_DESCRIPTION)).toBeInTheDocument();

    // Enabled-count badge: 1 of 2 contact tools on.
    expect(screen.getByLabelText('1 of 2 tools enabled')).toHaveTextContent(
      '1/2',
    );

    await checkAccessibility(container);
  });

  it('marks a partially enabled group indeterminate and a full group checked', () => {
    renderSelector({
      value: ['contact_read', 'product_read', 'product_write'],
    });

    expect(
      screen.getByRole('checkbox', { name: CONTACTS_GROUP }),
    ).toHaveAttribute('data-state', 'indeterminate');
    expect(
      screen.getByRole('checkbox', { name: PRODUCTS_GROUP }),
    ).toHaveAttribute('data-state', 'checked');
    expect(
      screen.getByRole('checkbox', { name: SYSTEM_GROUP }),
    ).toHaveAttribute('data-state', 'unchecked');
  });

  it('toggling one tool preserves selections in other groups', async () => {
    const { onChange, user } = renderSelector({ value: ['contact_read'] });

    await user.click(screen.getByRole('checkbox', { name: PRODUCT_READ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].sort()).toEqual([
      'contact_read',
      'product_read',
    ]);
  });

  it('group enable-all selects every tool in the group, and clears when full', async () => {
    const { onChange, user, unmount } = renderSelector({
      value: ['contact_read'],
    });

    // Indeterminate → click selects the rest of the group.
    await user.click(screen.getByRole('checkbox', { name: CONTACTS_GROUP }));
    expect(onChange.mock.calls[0][0].sort()).toEqual([
      'contact_read',
      'contact_write',
    ]);
    unmount();

    const { onChange: onChange2, user: user2 } = renderSelector({
      value: ['contact_read', 'contact_write'],
    });

    // Fully selected → click clears the group.
    await user2.click(screen.getByRole('checkbox', { name: CONTACTS_GROUP }));
    expect(onChange2.mock.calls[0][0]).toEqual([]);
  });

  it('filters tools and groups by search query', async () => {
    const { user } = renderSelector();

    await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), 'contact');

    // Contact tools stay; unrelated groups disappear.
    expect(
      screen.getByRole('checkbox', { name: CONTACT_READ }),
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
      screen.queryByRole('checkbox', { name: CONTACT_READ }),
    ).not.toBeInTheDocument();
  });

  it('excludes hidden tools from the picker', () => {
    renderSelector({ hiddenTools: new Set(['run_code']) });

    expect(
      screen.queryByRole('checkbox', { name: RUN_CODE }),
    ).not.toBeInTheDocument();
    // The rest of the catalog still renders.
    expect(
      screen.getByRole('checkbox', { name: CONTACT_READ }),
    ).toBeInTheDocument();
  });

  it('hides the platform-tool catalog for external agents', () => {
    renderSelector({ showPlatformTools: false, showWorkflows: false });

    expect(
      screen.queryByPlaceholderText(SEARCH_PLACEHOLDER),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: CONTACT_READ }),
    ).not.toBeInTheDocument();
    // Integration bindings (the external agent's MCP grant set) stay.
    expect(screen.getByText('Bound integrations')).toBeInTheDocument();
  });

  it('labels the workflow-bindings section "Bound automations" and shows the owning automation\'s title/description', async () => {
    mockAvailableWorkflows.mockReturnValueOnce({
      workflows: [
        {
          slug: 'create-github-pr',
          name: 'create-github-pr',
          description: 'Raw workflow spec summary — never shown.',
          automationSlug: 'create-github-pr',
          automationName: 'Create GitHub PR',
          automationDescription: 'Opens a pull request from your changes.',
        },
        {
          // No owning automation (a standalone workflow) — falls back to its
          // own name/spec-summary.
          slug: 'standalone-wf',
          name: 'standalone-wf',
          description: 'A standalone workflow with no owning automation.',
        },
      ],
      isLoading: false,
    });

    const { user } = renderSelector();

    // Section copy is automation-flavored, not "Bound workflows".
    expect(screen.getByText('Bound automations')).toBeInTheDocument();
    expect(screen.queryByText('Bound workflows')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('combobox', { name: 'Bound automations' }),
    );

    // Automation-owned: the AUTOMATION's title/description render — never the
    // workflow's own slug-derived name or raw spec summary.
    expect(
      screen.getByRole('option', { name: /Create GitHub PR/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Opens a pull request from your changes.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('create-github-pr')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Raw workflow spec summary — never shown.'),
    ).not.toBeInTheDocument();

    // Standalone workflow: falls back to its own name/description.
    expect(
      screen.getByRole('option', { name: /standalone-wf/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A standalone workflow with no owning automation.'),
    ).toBeInTheDocument();
  });
});
