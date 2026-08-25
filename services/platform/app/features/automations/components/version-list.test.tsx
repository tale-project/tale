import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { VersionList } from './version-list';

const versions = [
  {
    version: 1,
    message: 'first cut',
    testsPassed: true,
    createdBy: 'user:a',
    createdAt: 1_700_000_000_000,
  },
  {
    version: 2,
    message: 'add the digest step',
    testsPassed: false,
    createdBy: 'user:a',
    createdAt: 1_700_000_100_000,
  },
];

function renderList(deployedVersion: number | undefined = 1) {
  return render(
    <VersionList
      versions={versions}
      deployedVersion={deployedVersion}
      selectedVersion={2}
      onSelectVersion={vi.fn()}
    />,
  );
}

describe('VersionList', () => {
  it('marks the version that is live and does not offer deploy on the row', () => {
    renderList();
    expect(screen.getByText('Live')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Deploy/ }),
    ).not.toBeInTheDocument();
  });

  it('says which versions were saved with failing tests', () => {
    renderList();
    expect(screen.getByText('Tests failed')).toBeVisible();
    expect(screen.getByText('Tests passed')).toBeVisible();
  });

  it('shows the version messages so the history reads', () => {
    renderList();
    expect(screen.getByText('add the digest step')).toBeVisible();
    expect(screen.getByText('first cut')).toBeVisible();
  });

  it('is one bordered list with row dividers, not a stack of cards', () => {
    const { container } = renderList();
    const list = container.querySelector('ul');
    expect(list).toHaveClass('divide-y');
    expect(container.querySelectorAll('li.border, li.rounded-md')).toHaveLength(
      0,
    );
  });

  it('passes an axe audit', async () => {
    const { container } = renderList();
    await checkAccessibility(container);
  });
});
