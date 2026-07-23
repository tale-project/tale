// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

let automationsData:
  | Array<{ name: string; latest: number; deployedVersion?: number }>
  | undefined;
vi.mock('../hooks/queries', () => ({
  useAutomations: () => ({
    data: automationsData,
    isPending: false,
    isError: false,
  }),
}));

import { AutomationsList } from './automations-list';

// The list serves two surfaces: the org page and a project's Automations tab.
// These tests pin the link split — a project row must stay inside the project
// shell, an org row on the org routes.
describe('AutomationsList link targets', () => {
  it('links an org-page row to the org automation route', () => {
    automationsData = [{ name: 'org/digest', latest: 2, deployedVersion: 2 }];
    render(<AutomationsList organizationId="org-1" />);

    const link = screen.getByRole('link', { name: /org\/digest/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/automations/org__digest',
    );
  });

  it('links a project-tab row into the project shell', () => {
    automationsData = [{ name: 'desk/prepare-return', latest: 1 }];
    render(
      <AutomationsList
        organizationId="org-1"
        projectId={'proj_1' as Id<'projects'>}
      />,
    );

    const link = screen.getByRole('link', { name: /desk\/prepare-return/ });
    expect(link).toHaveAttribute(
      'href',
      '/dashboard/org-1/projects/proj_1/automations/desk__prepare-return',
    );
  });
});
