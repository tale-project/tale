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
const location = {
  pathname: '/dashboard/org-1/automations/billing__dunning/editor',
};

vi.mock('../hooks/queries', () => ({
  useAutomations: (...args: unknown[]) => {
    listArgs = args;
    return { data: automationsFixture, isPending: false };
  },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
  useLocation: () => location,
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

async function pickReminders(user: ReturnType<typeof renderSwitcher>['user']) {
  await user.click(screen.getByRole('button', { name: /switch automation/i }));
  await user.click(screen.getByRole('option', { name: /Reminders/ }));
}

describe('AutomationBreadcrumbSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listArgs = [];
    location.pathname = '/dashboard/org-1/automations/billing__dunning/editor';
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

    // Every shell lists the org's automations including project-bound ones,
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

  it('lists organization automations before project automations, sorted within each group', async () => {
    automationsFixture = [
      { name: 'alpha/project', latest: 1, projectIds: [PROJECT_ID] },
      { name: 'zulu/org', latest: 1, projectIds: [] },
      { name: 'beta/shared', latest: 1, projectIds: [PROJECT_ID, 'proj-2'] },
      { name: 'billing/dunning', latest: 1, projectIds: [] },
    ];
    const { user } = renderSwitcher({ projectId: PROJECT_ID });

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(4);
    for (const [index, slug] of [
      'billing/dunning',
      'zulu/org',
      'alpha/project',
      'beta/shared',
    ].entries()) {
      expect(options[index]).toHaveTextContent(slug);
    }
  });

  it("navigates to an org-level sibling's editor on the org detail route", async () => {
    const { user } = renderSwitcher();
    await pickReminders(user);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/billing__reminders/editor',
    });
  });

  it('routes a single-bound sibling into its project shell', async () => {
    automationsFixture[1]!.projectIds = [PROJECT_ID];
    const { user } = renderSwitcher();
    await pickReminders(user);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/projects/proj-1/automations/billing__reminders/editor',
    });
  });

  it.each([
    { projectIds: [PROJECT_ID] },
    { projectIds: [PROJECT_ID, 'proj-2'] },
  ])(
    'keeps the current project when the destination is bound to $projectIds',
    async ({ projectIds }) => {
      automationsFixture[1]!.projectIds = projectIds;
      location.pathname =
        '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor';
      const { user } = renderSwitcher({ projectId: PROJECT_ID });

      expect(listArgs).toEqual(['org-1', undefined, true]);

      await pickReminders(user);

      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/dashboard/org-1/projects/proj-1/automations/billing__reminders/editor',
      });
    },
  );

  it.each([
    {
      projectIds: [],
      destination: '/dashboard/org-1/automations/billing__reminders/editor',
    },
    {
      projectIds: ['proj-2'],
      destination:
        '/dashboard/org-1/projects/proj-2/automations/billing__reminders/editor',
    },
    {
      projectIds: ['proj-2', 'proj-3'],
      destination: '/dashboard/org-1/automations/billing__reminders/editor',
    },
  ])(
    'leaves the current project for a destination bound to $projectIds',
    async ({ projectIds, destination }) => {
      automationsFixture[1]!.projectIds = projectIds;
      location.pathname =
        '/dashboard/org-1/projects/proj-1/automations/billing__dunning/editor';
      const { user } = renderSwitcher({ projectId: PROJECT_ID });
      await pickReminders(user);

      expect(mockNavigate).toHaveBeenCalledWith({ to: destination });
    },
  );

  it('keeps the open tab on the sibling, like the project switcher', async () => {
    location.pathname =
      '/dashboard/org-1/automations/billing__dunning/versions';
    const { user } = renderSwitcher();
    await pickReminders(user);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/billing__reminders/versions',
    });
  });

  it("resets a run's own page to the sibling's Runs list", async () => {
    location.pathname =
      '/dashboard/org-1/automations/billing__dunning/runs/run_1';
    const { user } = renderSwitcher();
    await pickReminders(user);

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/org-1/automations/billing__reminders/runs',
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
    automationsFixture[1]!.projectIds = [PROJECT_ID];
    const { user, baseElement } = renderSwitcher();

    await user.click(
      screen.getByRole('button', { name: /switch automation/i }),
    );

    // Radix portals the menu outside the render container.
    await checkAccessibility(baseElement);
  });
});
