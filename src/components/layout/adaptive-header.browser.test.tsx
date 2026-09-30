import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { render, screen } from '@/tests/utils/render';

import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from './adaptive-header';
import { SubPanel, SubPanelHeader } from './sub-panel';

import '@tale/ui/globals.css';

// Real-Chromium coverage for the one header line across the screen: a section
// panel's head and the page header beside it are the same `h-13` box with the
// divider inside it, so their two rules meet as one line. A divider drawn
// outside a fixed-height row ends the page header one pixel lower, which reads
// as a step in the line where the panel meets the page.
afterEach(cleanup);

/** The `h-13` header row, border included. */
const HEADER_HEIGHT = 52;

/** The box around an element: the panel's head is its heading's parent, the
 * page header's root is the parent of its title row. */
function parentBox(element: HTMLElement): HTMLElement {
  // oxlint-disable-next-line testing-library/no-node-access -- the header boxes carry no role of their own; their geometry is what is under test
  const parent = element.parentElement;
  if (parent === null) throw new Error('The element has no parent');
  return parent;
}

function PanelBesidePage({ showBorder }: { showBorder: boolean }) {
  return (
    <AdaptiveHeaderProvider>
      <div className="flex h-[480px]">
        <SubPanel as="nav" width="list" ariaLabel="Knowledge">
          <SubPanelHeader title="Knowledge" />
        </SubPanel>
        <div className="flex min-w-0 flex-1 flex-col">
          <AdaptiveHeaderRoot standalone={false} showBorder={showBorder}>
            <AdaptiveHeaderTitle>Documents</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        </div>
      </div>
    </AdaptiveHeaderProvider>
  );
}

describe('AdaptiveHeaderRoot beside a section panel in Chromium', () => {
  it('ends its divider on the line the panel header ends on', async () => {
    await page.viewport(1280, 800);
    render(<PanelBesidePage showBorder />);

    const panelHeader = parentBox(
      screen.getByRole('heading', { level: 2, name: 'Knowledge' }),
    );
    const pageHeader = parentBox(
      parentBox(screen.getByRole('heading', { level: 1, name: 'Documents' })),
    );
    const panelBox = panelHeader.getBoundingClientRect();
    const pageBox = pageHeader.getBoundingClientRect();

    expect(getComputedStyle(pageHeader).borderBottomWidth).toBe('1px');
    expect(getComputedStyle(panelHeader).borderBottomWidth).toBe('1px');
    expect(pageBox.height).toBe(HEADER_HEIGHT);
    expect(pageBox.bottom).toBe(panelBox.bottom);
  });

  it('keeps the whole h-13 row when a tab strip draws the divider instead', async () => {
    await page.viewport(1280, 800);
    render(<PanelBesidePage showBorder={false} />);

    const pageHeader = parentBox(
      parentBox(screen.getByRole('heading', { level: 1, name: 'Documents' })),
    );
    expect(getComputedStyle(pageHeader).borderBottomWidth).toBe('0px');
    expect(pageHeader.getBoundingClientRect().height).toBe(HEADER_HEIGHT);
  });
});
