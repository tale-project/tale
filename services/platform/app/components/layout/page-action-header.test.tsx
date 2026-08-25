import { describe, expect, it } from 'vitest';

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
} from '@/app/components/layout/adaptive-header';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { PageActionHeader } from './page-action-header';

describe('PageActionHeader', () => {
  it('keeps the description under the title, not beside the actions', () => {
    render(
      <PageActionHeader
        title="Chase overdue invoices"
        description="Sends the dunning ladder."
        actions={<button type="button">Save</button>}
      />,
    );
    const description = screen.getByText('Sends the dunning ladder.');
    const title = screen.getByText('Chase overdue invoices');
    expect(description.compareDocumentPosition(title)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  it('portals identity next to the title, not into the action cluster', () => {
    render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot>
          <h1>Jj</h1>
        </AdaptiveHeaderRoot>
        <PageActionHeader
          identity={<button type="button">Version</button>}
          actions={<button type="button">Save</button>}
        />
      </AdaptiveHeaderProvider>,
    );
    const title = screen.getByRole('heading', { name: 'Jj' });
    const version = screen.getByRole('button', { name: 'Version' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(title.compareDocumentPosition(version)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(version.compareDocumentPosition(save)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getAllByRole('button', { name: 'Version' })).toHaveLength(1);
  });

  it('portals the cluster into the adaptive header on desktop', () => {
    render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot>
          <h1>Automations / Jj</h1>
        </AdaptiveHeaderRoot>
        <PageActionHeader
          description="A scratch canvas for trying the workbench."
          actions={<button type="button">Test run</button>}
        />
      </AdaptiveHeaderProvider>,
    );
    expect(
      screen.getByRole('heading', { name: 'Automations / Jj' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Test run' })).toBeVisible();
    expect(
      screen.getByText('A scratch canvas for trying the workbench.'),
    ).toBeVisible();
    // One copy of the cluster — not a second strip under the title.
    expect(screen.getAllByRole('button', { name: 'Test run' })).toHaveLength(1);
  });

  it('passes axe audit', async () => {
    const { container } = render(
      <PageActionHeader
        title="Title"
        description="Description"
        actions={<button type="button">Save</button>}
      />,
    );
    await checkAccessibility(container);
  });
});
