import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationBreadcrumbSwitcher } from './automation-breadcrumb-switcher';

const mockNavigate = vi.fn();

type AutomationRow = {
  name: string;
  latest: number;
  projectIds: string[];
  presentation?: unknown;
};

let automationsFixture: AutomationRow[] = [];
let listArgs: unknown[] = [];

vi.mock('../hooks/queries', () => ({
  useAutomations: (...args: unknown[]) => {
    listArgs = args;
    return { data: automationsFixture, isPending: false };
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

const PROJECT_ID = 'proj-1';

function renderSwitcher(props: { projectId?: string } = {}) {
  return render(
    <AutomationBreadcrumbSwitcher
      organizationId="org-1"
      automationSlug="billing/dunning"
      displayName="Chase overdue invoices"
      {...props}
    />,
  );
}

describe('AutomationBreadcrumbSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listArgs = [];
    automationsFixture = [
      {
        name: 'billing/dunning',
        latest: 1,
        projectIds: [],
        presentation: { name: 'Chase overdue invoices' },
      },
      { name: 'billing/reminders', latest: 1, projectIds: [] },
    ];
  });

  it('lists siblings by display name with the slug as caption', async () => {
    const { user } = renderSwitcher();

    // The org shell lists the org's automations including project-bound ones,
    // exactly like the Automations table.
    expect(listArgs).toEqual(['org-1', undefined, true]);

    await user.click(
      screen.getByRole('button', {
        name: /switch automation, current: chase overdue invoices/i,
      }),
    );

    expect(
      screen.getByRole('option', { name: /Chase overdue invoices/ }),
    ).toBeInTheDocument();
    // The undeclared sibling falls back to its slug read as a title, with the
    // raw slug as the caption row.
    expect(
      screen.getByRole('option', { name: /Reminders/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('billing/reminders')).toBeInTheDocument();
  });

  it('navigates to an org-level sibling on the org detail route', async () => {
    const { user } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );
    await user.click(screen.getByRole('option', { name: /Reminders/ }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug',
      params: { id: 'org-1', automationSlug: 'billing__reminders' },
    });
  });

  it('routes a single-bound sibling into its project shell', async () => {
    automationsFixture = [
      { name: 'billing/dunning', latest: 1, projectIds: [] },
      { name: 'billing/reminders', latest: 1, projectIds: [PROJECT_ID] },
    ];
    const { user } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );
    await user.click(screen.getByRole('option', { name: /Reminders/ }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: PROJECT_ID,
        automationSlug: 'billing__reminders',
      },
    });
  });

  it('stays inside the project shell when scoped to a project', async () => {
    const { user } = renderSwitcher({ projectId: PROJECT_ID });

    // The project shell lists only that project's automations.
    expect(listArgs).toEqual(['org-1', PROJECT_ID, false]);

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );
    await user.click(screen.getByRole('option', { name: /Reminders/ }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug',
      params: {
        id: 'org-1',
        projectId: PROJECT_ID,
        automationSlug: 'billing__reminders',
      },
    });
  });

  it('does not navigate when the current automation is chosen again', async () => {
    const { user } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );
    await user.click(
      screen.getByRole('option', { name: /Chase overdue invoices/ }),
    );

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('matches the slug when searching', async () => {
    const { user } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );
    await user.type(screen.getByRole('combobox'), 'billing/rem');

    expect(
      screen.getByRole('option', { name: /Reminders/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Chase overdue invoices/ }),
    ).not.toBeInTheDocument();
  });

  it('renders a plain name when the listing is empty', () => {
    automationsFixture = [];
    renderSwitcher();

    expect(
      screen.queryByRole('button', { name: /switch automation/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Chase overdue invoices')).toBeInTheDocument();
  });

  it('passes an axe audit with the menu open', async () => {
    const { user, container } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );

    await checkAccessibility(container);
  });
});
