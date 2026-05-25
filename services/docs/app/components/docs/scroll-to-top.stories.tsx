import type { Meta, StoryObj } from '@storybook/react';

import { ScrollToTop } from './scroll-to-top';

const meta = {
  title: 'Docs/ScrollToTop',
  component: ScrollToTop,
  parameters: {
    // The button is positioned fixed bottom-right, so a full-frame canvas
    // gives it real estate to render naturally.
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ScrollToTop>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The button stays invisible (`opacity-0 pointer-events-none`) until the
 * page has been scrolled past `SCROLL_THRESHOLD_PX`. The story renders a
 * tall placeholder so the reader can scroll inside the Storybook canvas
 * and watch the button fade in.
 */
export const Default: Story = {
  render: () => (
    <div className="bg-bg-base text-fg-base min-h-[2400px] p-8">
      <h1 className="text-2xl font-semibold">Scroll down…</h1>
      <p className="text-fg-muted mt-2 max-w-prose text-sm">
        The floating &ldquo;back to top&rdquo; button appears once you scroll
        past about 600&nbsp;px. The story canvas is tall enough to exercise the
        threshold without leaving Storybook.
      </p>
      <ScrollToTop />
    </div>
  ),
};
