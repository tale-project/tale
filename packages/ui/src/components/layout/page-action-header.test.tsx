import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderTabActionsSlot,
} from '@tale/ui/adaptive-header';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { PageActionHeader } from './page-action-header';

// The breakpoint is a matchMedia read; flip it per test instead of resizing.
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => viewport.mobile,
}));

afterEach(() => {
  viewport.mobile = false;
});

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

  it('puts the cluster in the tab strip when the page has one', () => {
    // A tabbed page keeps its verbs where every tabbed page keeps
    // Save/Discard — the strip's trailing slot — not in the title row.
    render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot>
          <h1>Automations / Jj</h1>
        </AdaptiveHeaderRoot>
        <nav aria-label="Automations navigation">
          <AdaptiveHeaderTabActionsSlot />
        </nav>
        <PageActionHeader actions={<button type="button">Save</button>} />
      </AdaptiveHeaderProvider>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.closest('nav')).toBe(
      screen.getByRole('navigation', { name: 'Automations navigation' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Automations / Jj' }).parentElement,
    ).not.toContainElement(save);
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('holds the cluster back below md until the strip hands over its slot', () => {
    // The dock that carries the strip's slot mounts after the first paint;
    // a row that declares `tabsFollow` keeps the cluster out of a local row
    // meanwhile, then the slot receives it — never two homes, never a flash.
    viewport.mobile = true;
    const { rerender } = render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot tabsFollow>
          <h1>Automations / Jj</h1>
        </AdaptiveHeaderRoot>
        <PageActionHeader actions={<button type="button">Save</button>} />
      </AdaptiveHeaderProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    rerender(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot tabsFollow>
          <h1>Automations / Jj</h1>
        </AdaptiveHeaderRoot>
        <nav aria-label="Automations navigation">
          <AdaptiveHeaderTabActionsSlot />
        </nav>
        <PageActionHeader actions={<button type="button">Save</button>} />
      </AdaptiveHeaderProvider>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.closest('nav')).toBe(
      screen.getByRole('navigation', { name: 'Automations navigation' }),
    );
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('keeps the local row below md when no strip follows', () => {
    viewport.mobile = true;
    render(
      <AdaptiveHeaderProvider>
        <AdaptiveHeaderRoot>
          <h1>Jj</h1>
        </AdaptiveHeaderRoot>
        <PageActionHeader
          title="Jj"
          actions={<button type="button">Save</button>}
        />
      </AdaptiveHeaderProvider>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
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
