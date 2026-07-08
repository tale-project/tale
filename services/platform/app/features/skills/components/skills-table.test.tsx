// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { SkillListEntry } from '../hooks/queries';

// The DataTable shell resolves the org from the router (useOrganizationId ->
// useParams) and primitives preload routes via useRouter. There is no
// RouterProvider in jsdom, so partial-mock the router (keeping real exports
// like Link) and pin the org id the table reads.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ preloadRoute: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const SKILLS = [
  {
    slug: 'issue-triage',
    name: 'Issue triage',
    description: 'Label and route incoming issues.',
    hash: 'hash-1',
  },
  {
    slug: 'release-notes',
    name: 'Release notes',
    description: 'Draft the changelog entry.',
    hash: 'hash-2',
  },
] as SkillListEntry[];

vi.mock('../hooks/queries', () => ({
  useListSkills: () => ({
    skills: SKILLS,
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

import { SkillsTable } from './skills-table';

function renderBindingTable(overrides?: {
  selected?: string[];
  onChange?: (slugs: string[]) => void;
  max?: number;
}) {
  const onChange = overrides?.onChange ?? vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SkillsTable
        organizationId="org-1"
        bindingMode={{
          selected: overrides?.selected ?? [],
          onChange,
          max: overrides?.max ?? 8,
        }}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onChange };
}

describe('SkillsTable (agent binding)', () => {
  it('renders a binding checkbox per skill row and the bound counter', () => {
    renderBindingTable({ selected: ['issue-triage'] });

    expect(screen.getByText('Issue triage')).toBeInTheDocument();
    expect(screen.getByText('Release notes')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Bind issue-triage' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Bind release-notes' }),
    ).not.toBeChecked();
    expect(screen.getByText('1/8 bound')).toBeInTheDocument();
  });

  it('adds and removes slugs through the binding selection', async () => {
    const onChange = vi.fn();
    const { user } = renderBindingTable({
      selected: ['issue-triage'],
      onChange,
    });

    await user.click(
      screen.getByRole('checkbox', { name: 'Bind release-notes' }),
    );
    expect(onChange).toHaveBeenCalledWith(['issue-triage', 'release-notes']);

    await user.click(
      screen.getByRole('checkbox', { name: 'Bind issue-triage' }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('blocks (but keeps focusable) unchecked rows at the binding cap', async () => {
    const onChange = vi.fn();
    const { user } = renderBindingTable({
      selected: ['issue-triage'],
      onChange,
      max: 1,
    });

    const blocked = screen.getByRole('checkbox', {
      name: 'Bind release-notes',
    });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toHaveAttribute(
      'aria-describedby',
      'skill-binding-at-cap-reason',
    );
    await user.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers no bulk-delete or upload management affordances', () => {
    renderBindingTable();
    // Management (upload/duplicate/delete) lives in the Skills settings
    // catalog; the binding table is selection-only.
    expect(
      screen.queryByRole('button', { name: /Upload skill/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /Select all/i }),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = renderBindingTable({ selected: ['issue-triage'] });
    // `empty-table-header` is disabled: the binding checkbox column
    // intentionally has an empty <th> header (every selection column in the
    // app does). That is a deliberate primitive-level decision, not a defect
    // of the binding table under test.
    await checkAccessibility(container, {
      rules: { 'empty-table-header': { enabled: false } },
    });
  });
});
