// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  AutomationVersionPill,
  RunVersionMenu,
} from './automation-version-pill';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  // A link that says where it leads, so the suite can read it back.
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children?: ReactNode;
    to?: string;
    params?: unknown;
    search?: unknown;
    [key: string]: unknown;
  }) =>
    createElement(
      'a',
      {
        href: '#',
        'data-to': to,
        'data-params': JSON.stringify(params),
        'data-search': JSON.stringify(search),
        ...props,
      },
      children,
    ),
  useNavigate: () => navigate,
}));
vi.mock('../hooks/queries', () => ({
  useAutomationVersions: () => ({
    data: [
      {
        version: 3,
        message: 'Post the summary',
        createdBy: 'user-me',
        createdAt: 1_791_000_000_000,
        createdVia: 'app',
        viaInferred: false,
        clientName: null,
      },
    ],
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [] }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-me' } }),
}));

const PLACE = { organizationId: 'org-1', automationSlug: 'ops/digest' };

describe('AutomationVersionPill', () => {
  it('links a run’s version to the editor, and says when it is the live one', () => {
    render(
      <>
        <AutomationVersionPill {...PLACE} version={3} deployedVersion={3} />
        <AutomationVersionPill
          {...PLACE}
          projectId="p-1"
          version={2}
          deployedVersion={3}
        />
      </>,
    );
    const live = screen.getByRole('link', {
      name: 'v3, live. Open it in the editor.',
    });
    expect(live).toHaveTextContent('v3');
    expect(live).toHaveAttribute(
      'data-to',
      '/dashboard/$id/automations/$automationSlug/editor',
    );
    expect(live).toHaveAttribute('data-search', JSON.stringify({ version: 3 }));
    const older = screen.getByRole('link', {
      name: 'v2. Open it in the editor.',
    });
    // Inside a project the version opens in the project's shell.
    expect(older).toHaveAttribute(
      'data-to',
      '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor',
    );
  });

  it('keeps its click from the row around it', async () => {
    const onRow = vi.fn();
    const { user } = render(
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for a table row that opens on click
      <div onClick={onRow}>
        <AutomationVersionPill {...PLACE} version={3} />
      </div>,
    );
    await user.click(screen.getByRole('link', { name: /^v3/ }));
    expect(onRow).not.toHaveBeenCalled();
  });

  it('names the version’s message, who saved it and when on hover', async () => {
    const { user } = render(
      <AutomationVersionPill {...PLACE} version={3} deployedVersion={5} />,
    );
    await user.hover(screen.getByRole('link', { name: /^v3/ }));
    expect(
      (await screen.findAllByText('Post the summary')).at(-1),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/^You · in the app · /).at(-1),
    ).toBeInTheDocument();
  });
});

describe('RunVersionMenu', () => {
  it('opens the version, compares it with the live one, or leads to the history', async () => {
    const { user } = render(
      <RunVersionMenu {...PLACE} version={3} deployedVersion={5} />,
    );
    await user.click(
      screen.getByRole('button', { name: 'v3: actions for this version' }),
    );
    expect(
      screen.getByRole('menuitem', { name: 'Open v3 in the editor' }),
    ).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'Version history' }),
    ).toBeVisible();
    await user.click(
      screen.getByRole('menuitem', { name: 'Compare v3 with live v5' }),
    );
    // The newer of the two is compared against the older.
    expect(navigate).toHaveBeenLastCalledWith({
      to: '/dashboard/$id/automations/$automationSlug/versions/$version',
      params: { id: 'org-1', automationSlug: 'ops__digest', version: '5' },
      search: { from: 3 },
    });
  });

  it('offers no comparison when the run ran the live version', async () => {
    const { user } = render(
      <RunVersionMenu {...PLACE} version={5} deployedVersion={5} />,
    );
    await user.click(
      screen.getByRole('button', {
        name: 'v5, live: actions for this version',
      }),
    );
    expect(screen.queryByRole('menuitem', { name: /^Compare/ })).toBeNull();
  });
});
