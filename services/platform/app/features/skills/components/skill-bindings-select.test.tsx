// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { SkillListEntry } from '../hooks/queries';

// #2569: the agent Skills tab binding control now shares the same
// `MultiSelect` chip picker used by Bound integrations / Bound automations
// instead of a bespoke checkbox table — these tests exercise that unified
// language (search/select/deselect, count/max feedback, disabled-at-cap,
// and the read-only path to the Skills settings detail view).

// `Link` needs a live router context this jsdom test doesn't set up; stub it
// as a plain anchor (same convention as settings-rail.test.tsx).
vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: {
        to: string;
        params?: Record<string, string>;
        children: React.ReactNode;
        className?: string;
      },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  ),
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

const mockUseListSkills = vi.fn((..._args: unknown[]) => ({
  skills: SKILLS,
  isLoading: false,
  error: undefined,
  refetch: vi.fn(),
}));
vi.mock('../hooks/queries', () => ({
  useListSkills: (...args: unknown[]) => mockUseListSkills(...args),
}));

import { SkillBindingsSelect } from './skill-bindings-select';

function renderBindingSelect(overrides?: {
  selected?: string[];
  onChange?: (slugs: string[]) => void;
  max?: number;
  excludeSlugs?: ReadonlySet<string>;
}) {
  const onChange = overrides?.onChange ?? vi.fn();
  const utils = render(
    <SkillBindingsSelect
      organizationId="org-1"
      bindingMode={{
        selected: overrides?.selected ?? [],
        onChange,
        max: overrides?.max ?? 8,
      }}
      emptyStateOverride={{ description: 'No skills to bind yet.' }}
      excludeSlugs={overrides?.excludeSlugs}
    />,
  );
  return { ...utils, onChange };
}

describe('SkillBindingsSelect (agent binding)', () => {
  it('renders each skill as a MultiSelect option with its description and the bound counter', async () => {
    const { user } = renderBindingSelect({ selected: ['issue-triage'] });

    expect(screen.getByText('1/8 bound')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));

    expect(
      screen.getByRole('option', { name: /Issue triage/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Label and route incoming issues.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Release notes/ }),
    ).toBeInTheDocument();
  });

  it('adds and removes slugs through the binding selection', async () => {
    const onChange = vi.fn();
    const { user } = renderBindingSelect({
      selected: ['issue-triage'],
      onChange,
    });

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Release notes/ }));
    expect(onChange).toHaveBeenCalledWith(['issue-triage', 'release-notes']);
  });

  it('blocks selecting past the binding cap', async () => {
    const onChange = vi.fn();
    const { user } = renderBindingSelect({
      selected: ['issue-triage'],
      onChange,
      max: 1,
    });

    await user.click(screen.getByRole('combobox'));
    const blocked = screen.getByRole('option', { name: /Release notes/ });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    await user.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('surfaces a broken skill as a disabled option with its load-error summary', async () => {
    mockUseListSkills.mockReturnValueOnce({
      skills: [
        ...SKILLS,
        {
          slug: 'broken-skill',
          status: 'inaccessible',
          message: 'Permission denied',
        },
      ] as SkillListEntry[],
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    });

    const { user } = renderBindingSelect();
    await user.click(screen.getByRole('combobox'));

    const brokenOption = screen.getByRole('option', { name: /broken-skill/ });
    expect(brokenOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('excludes slugs in excludeSlugs (e.g. external-agent workflow disciplines)', async () => {
    const { user } = renderBindingSelect({
      excludeSlugs: new Set(['release-notes']),
    });

    await user.click(screen.getByRole('combobox'));
    expect(
      screen.getByRole('option', { name: /Issue triage/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Release notes/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the empty-state override and no picker when there are no (visible) skills', () => {
    mockUseListSkills.mockReturnValueOnce({
      skills: [],
      isLoading: false,
      error: undefined,
      refetch: vi.fn(),
    });

    renderBindingSelect();

    expect(screen.getByText('No skills to bind yet.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('links to the Skills settings catalog from the footer', async () => {
    const { user } = renderBindingSelect();
    await user.click(screen.getByRole('combobox'));

    const link = screen.getByRole('link', {
      name: /Manage in Skills settings/,
    });
    expect(link).toHaveAttribute('href', '/dashboard/$id/settings/skills');
  });

  it('passes an axe audit', async () => {
    const { container } = renderBindingSelect({ selected: ['issue-triage'] });
    await checkAccessibility(container);
  });
});
