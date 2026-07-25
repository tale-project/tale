import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { VersionList } from './version-list';

/**
 * The deploy gate refuses a version that was saved with failing tests, and its
 * message names both the version and the fix. These tests hold the list to
 * showing that sentence rather than a generic failure — the refusal IS the
 * feedback.
 */

const deployMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/mutations', () => ({
  useDeployAutomation: () => ({
    mutate: deployMutate,
    isPending: false,
    variables: undefined,
  }),
}));

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
      organizationId="org"
      name="billing/dunning"
      versions={versions}
      deployedVersion={deployedVersion}
      selectedVersion={2}
      onSelectVersion={vi.fn()}
    />,
  );
}

describe('VersionList', () => {
  it('marks the version that is live and offers to deploy the others', () => {
    renderList();
    expect(screen.getByText('Live')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Deploy' })).toHaveLength(1);
  });

  it('hides the deploy control from readers without the developer capability', () => {
    render(
      <VersionList
        organizationId="org"
        name="billing/dunning"
        versions={versions}
        deployedVersion={1}
        selectedVersion={2}
        onSelectVersion={vi.fn()}
        canDeploy={false}
      />,
    );
    // The live marker stays — which version runs is a reader's fact too.
    expect(screen.getByText('Live')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Deploy' }),
    ).not.toBeInTheDocument();
  });

  it('says which versions were saved with failing tests', () => {
    renderList();
    expect(screen.getByText('Tests failed')).toBeVisible();
    expect(screen.getByText('Tests passed')).toBeVisible();
  });

  it("surfaces the deploy gate's own refusal, not a generic error", async () => {
    deployMutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError({
          data: {
            code: 'AUTOMATION_DEPLOY_REJECTED',
            message:
              'deploy gate: billing/dunning@2 was saved with failing tests — fix them and save a new version',
          },
        });
      },
    );
    const { user } = renderList();
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(
      screen.getByText(
        'deploy gate: billing/dunning@2 was saved with failing tests — fix them and save a new version',
      ),
    ).toBeVisible();
  });

  it('shows the version messages so the history reads', () => {
    renderList();
    expect(screen.getByText('add the digest step')).toBeVisible();
    expect(screen.getByText('first cut')).toBeVisible();
  });

  it('passes an axe audit', async () => {
    const { container } = renderList();
    await checkAccessibility(container);
  });
});
