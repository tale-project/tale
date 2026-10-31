// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

/** The bound projects the column names, by id, and the ids it asked for:
 * never every project (#5204). */
const named = vi.hoisted(() => ({
  projects: new Map<string, { _id: string; name: string }>(),
  ids: [] as string[],
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useNamedProjects: (_organizationId: string, ids: readonly string[]) => {
    named.ids = [...ids];
    return { projects: named.projects, isPending: false };
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ id: 'org-1' }),
  useLocation: () => ({ pathname: '/dashboard/org-1/automations' }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/app/hooks/use-preload-route', () => ({
  usePreloadRoute: () => vi.fn(),
}));

vi.mock('./automation-row-actions', () => ({
  AutomationRowActions: () => <div data-testid="row-actions" />,
}));

// The dialog is covered with its own tests: here it only has to open for a
// new automation and go away again.
vi.mock('./coding-agent-entry', () => ({
  CodingAgentDialog: ({
    context,
    onOpenChange,
  }: {
    context: { kind: string };
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label={`coding agent: ${context.kind}`}>
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
    </div>
  ),
}));

// The catalog is covered with its own tests: here it only has to open, on
// the tab it was asked for.
vi.mock('./template-catalog-dialog', () => ({
  TemplateCatalogDialog: ({
    initialCategory,
  }: {
    initialCategory?: string;
  }) => (
    <div
      role="dialog"
      aria-label="template catalog"
      data-tab={initialCategory ?? 'all'}
    />
  ),
}));

let automationsData:
  | Array<{
      name: string;
      latest: number;
      projectIds: string[];
      deployedVersion?: number;
      presentation?: unknown;
    }>
  | undefined;
vi.mock('../hooks/queries', () => ({
  useAutomations: () => ({
    data: automationsData,
    isPending: false,
    isError: false,
  }),
}));

import { AutomationsList } from './automations-list';

describe('AutomationsList', () => {
  beforeEach(() => {
    navigate.mockClear();
    named.projects = new Map();
    named.ids = [];
  });

  it('navigates an org-page row to the org automation route', async () => {
    automationsData = [
      { name: 'org/digest', latest: 2, projectIds: [], deployedVersion: 2 },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('org/digest'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params: { id: 'org-1', automationSlug: 'org__digest' },
    });
  });

  it('navigates a project-tab row into the project shell', async () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: [] },
    ];
    const { user } = render(
      <AutomationsList organizationId="org-1" projectId={'proj_1' as string} />,
    );

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('routes a single-bound org-page row into its project shell', async () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: ['proj_1'] },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
      params: {
        id: 'org-1',
        projectId: 'proj_1',
        automationSlug: 'desk__prepare-return',
      },
    });
  });

  it('keeps a multi-bound row on the org route and shows every project chip', async () => {
    automationsData = [
      {
        name: 'desk/prepare-return',
        latest: 1,
        projectIds: ['proj_1', 'proj_2'],
      },
    ];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(screen.getByText('desk/prepare-return'));
    expect(navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/editor',
      params: { id: 'org-1', automationSlug: 'desk__prepare-return' },
    });
    expect(screen.getAllByText('automations.list.projectBound')).toHaveLength(
      2,
    );
  });

  it("names each row's bound projects from the projects it names", () => {
    named.projects = new Map([
      ['proj_1', { _id: 'proj_1', name: 'Document desk' }],
      ['proj_150', { _id: 'proj_150', name: 'Field service' }],
    ]);
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: ['proj_1'] },
      {
        name: 'field/dispatch',
        latest: 1,
        projectIds: ['proj_150', 'proj_gone'],
      },
      { name: 'org/digest', latest: 1, projectIds: [] },
    ];
    render(<AutomationsList organizationId="org-1" />);

    expect(named.ids).toEqual(['proj_1', 'proj_150', 'proj_gone']);
    expect(screen.getByText('Document desk')).toBeInTheDocument();
    expect(screen.getByText('Field service')).toBeInTheDocument();
    // A project no read names keeps the generic chip.
    expect(screen.getAllByText('automations.list.projectBound')).toHaveLength(
      1,
    );
  });

  it('names no project in a project tab, which has no projects column', () => {
    automationsData = [
      { name: 'desk/prepare-return', latest: 1, projectIds: ['proj_1'] },
    ];
    render(
      <AutomationsList organizationId="org-1" projectId={'proj_1' as string} />,
    );
    expect(named.ids).toEqual([]);
  });
});

describe('AutomationsList frame', () => {
  it('renders the fixed frame every overview list uses', () => {
    // The defect this locks: Automations used to render the non-sticky
    // layout, so the whole page scrolled and the search + Create toolbar
    // slid away — while Projects and the Knowledge tables kept theirs. One
    // scrollport, owned by the table, at all three.
    automationsData = [{ name: 'org/digest', latest: 1, projectIds: [] }];
    render(<AutomationsList organizationId="org-1" />);

    expect(screen.getByTestId('data-table-scrollport')).toBeInTheDocument();
  });
});

describe('AutomationsList presentation', () => {
  it('shows the pack s declared glyph and catalog chips beside the name', () => {
    automationsData = [
      {
        name: 'gmail/triage-inbox',
        latest: 1,
        projectIds: [],
        presentation: {
          name: 'Triage the Gmail inbox',
          icon: 'mail',
          labels: ['Email', 'Gmail'],
        },
      },
    ];
    const { container } = render(<AutomationsList organizationId="org-1" />);

    expect(screen.getByText('Triage the Gmail inbox')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
    // The bundled lucide set resolves offline: the declared glyph renders as
    // an Iconify svg, not the neutral fallback.
    expect(container.querySelector('svg.iconify--lucide')).not.toBeNull();
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull();
  });

  it('draws a product’s own logo for an automation a template made', () => {
    automationsData = [
      {
        name: 'support-mailbox',
        latest: 1,
        projectIds: [],
        presentation: {
          name: 'Support mailbox',
          icon: 'brand:gmail',
        },
      },
    ];
    const { container } = render(<AutomationsList organizationId="org-1" />);

    expect(screen.getByText('Support mailbox')).toBeInTheDocument();
    // The Gmail logo, not a lucide glyph and not the neutral fallback.
    expect(container.querySelector('svg.iconify--lucide')).toBeNull();
    expect(container.querySelector('svg.lucide-sparkles')).toBeNull();
    expect(container.querySelector('svg.lucide-puzzle')).toBeNull();
    expect(container.querySelector('svg [fill="#EA4335"]')).not.toBeNull();
  });

  it('renders the name as a link the keyboard can reach and open', () => {
    automationsData = [{ name: 'weekly-report', latest: 1, projectIds: [] }];
    render(<AutomationsList organizationId="org-1" />);

    // `onRowClick` is a pointer convenience only — a `<tr>` takes no focus —
    // so the name itself is the row's real, named link (AUTO-A3).
    expect(screen.getByRole('link', { name: 'Weekly report' })).toHaveAttribute(
      'href',
      '/dashboard/$id/automations/$automationSlug/editor',
    );
  });

  it('falls back to the neutral glyph and no chips without a presentation', () => {
    automationsData = [{ name: 'weekly-report', latest: 1, projectIds: [] }];
    const { container } = render(<AutomationsList organizationId="org-1" />);

    expect(screen.getByText('Weekly report')).toBeInTheDocument();
    expect(container.querySelector('svg.iconify--lucide')).toBeNull();
    expect(container.querySelector('svg.lucide-sparkles')).not.toBeNull();
  });
});

describe('AutomationsList create menu', () => {
  it.each([undefined, 'proj_1'])(
    'offers a template, a coding agent, blank and upload from the toolbar for project %s',
    async (projectId) => {
      automationsData = [];
      const { user } = render(
        <AutomationsList
          organizationId="org-1"
          {...(projectId ? { projectId } : {})}
        />,
      );

      expect(
        screen.getByText('automations.list.empty.title'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('automations.list.empty.description'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 2, name: 'automations.title' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('automations.list.description'),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: 'automations.list.createButton' }),
      );

      // A template leads: the quickest way to an automation that works.
      // The coding agent follows: it builds what no template covers.
      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent),
      ).toEqual([
        'automations.createMenu.template',
        'automations.createMenu.withAgent',
        'automations.createMenu.blank',
        'automations.upload.trigger',
      ]);
      expect(
        screen.getByRole('menuitem', { name: 'automations.createMenu.blank' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('menuitem', { name: 'automations.upload.trigger' }),
      ).toBeInTheDocument();
    },
  );

  it('invites an empty list to the template catalog [AUTO-R57]', async () => {
    automationsData = [];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', {
        name: 'automations.list.empty.browseTemplates',
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'template catalog' }),
    ).toBeInTheDocument();
  });

  it('opens the template catalog on the tab a link asks for', async () => {
    automationsData = [];
    render(<AutomationsList organizationId="org-1" openTemplates="inbox" />);
    expect(
      await screen.findByRole('dialog', { name: 'template catalog' }),
    ).toHaveAttribute('data-tab', 'inbox');
  });

  it('opens the coding agent for a new automation from the menu, and closes it again', async () => {
    automationsData = [];
    const { user } = render(<AutomationsList organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'automations.list.createButton' }),
    );
    await user.click(
      screen.getByRole('menuitem', {
        name: 'automations.createMenu.withAgent',
      }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'coding agent: create',
    });
    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('keeps create in the table toolbar when rows exist', () => {
    automationsData = [
      { name: 'org/digest', latest: 1, projectIds: [], deployedVersion: 1 },
    ];
    render(<AutomationsList organizationId="org-1" />);

    expect(
      screen.queryByText('automations.list.description'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'automations.list.createButton' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('row-actions')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('automations.list.searchPlaceholder'),
    ).toBeInTheDocument();
  });
});
