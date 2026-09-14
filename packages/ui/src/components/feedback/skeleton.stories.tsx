import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { expect } from 'storybook/test';

import { StatCard, StatCardGrid } from '../data-display/stat-card-grid';
import { Checkbox } from '../forms/checkbox';
import { Input } from '../forms/input';
import { Slider } from '../forms/slider';
import { Textarea } from '../forms/textarea';
import { TooltipProvider } from '../overlays/tooltip';
import { Button } from '../primitives/button';
import { SearchResultRow } from '../search/search-result-row';
import { SearchSkeleton } from '../search/search-skeleton';
import { Badge } from './badge';
import { SkeletonBox, SkeletonCircle, SkeletonText } from './skeleton';
import { Skeletonize } from './skeleton-context';

const meta: Meta<typeof SkeletonBox> = {
  title: 'Feedback/Skeleton',
  component: SkeletonBox,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `
Loading placeholders with a pulse animation. They are **wrapping** primitives:
you wrap the REAL content and the skeleton sizes itself to that content — there
is no sizing math at the call site.

- **\`SkeletonBox\`** — wrap any dynamic value/control:
  \`<SkeletonBox>{value}</SkeletonBox>\`. \`fullWidth\` makes it span its
  container. Use \`asChild\` on real controls or flex/grid items to preserve
  the child's own layout, dimensions and border radius.
- **\`SkeletonCircle\`** — round variant for avatars / status dots.
- **\`SkeletonText\`** — masked multi-line text shaped like real words; inherits
  the surrounding font metrics.
- **\`Skeletonize\`** — wrap a region of REAL component JSX; descendant
  skeleton-aware leaves (Input, Button, Badge, \`SkeletonBox\`) mask themselves
  while \`loading\`. The same elements remain mounted in both states.

## Accessibility
Skeleton primitives are \`aria-hidden\`; the enclosing \`Skeletonize\` announces
"Loading" once for the whole region.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SkeletonBox>;

export const WrappingValuesAndControls: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Skeletonize loading>
        <p className="text-sm">
          Balance: <SkeletonBox>$12,480.55</SkeletonBox>
        </p>
        <Button>Save changes</Button>
      </Skeletonize>
      <p className="text-fg-muted text-xs">
        Inside <code>Skeletonize loading</code> the value and button keep their
        real markup with a pulse overlay; flip <code>loading</code> off and the
        same tree shows the content.
      </p>
    </div>
  ),
};

export const Text: Story = {
  render: () => (
    <div className="w-80 space-y-6">
      <Skeletonize loading>
        <div className="text-sm">
          <SkeletonText />
        </div>
        <div className="text-sm leading-6">
          <SkeletonText lines={4} />
        </div>
      </Skeletonize>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Word-shaped multi-line text; the last line tapers like wrapped prose.',
      },
    },
  },
};

export const Card: Story = {
  render: () => (
    <Skeletonize loading>
      <div className="w-72 space-y-4 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <SkeletonCircle>
            <span className="block size-10" />
          </SkeletonCircle>
          <div className="flex-1 space-y-2 text-sm">
            <SkeletonText />
            <SkeletonText />
          </div>
        </div>
        <div className="text-sm">
          <SkeletonText lines={3} />
        </div>
      </div>
    </Skeletonize>
  ),
};

function GeometryExample() {
  const [loading, setLoading] = useState(true);
  return (
    <TooltipProvider>
      <div className="space-y-6">
        <button type="button" onClick={() => setLoading(!loading)}>
          Toggle loading
        </button>
        {[280, 760].map((width) => (
          <Skeletonize key={width} loading={loading}>
            <div className="space-y-4" style={{ width }} data-bounds="region">
              <div className="flex items-center gap-3" data-bounds="checks">
                <Checkbox
                  id={`checkbox-${width}`}
                  aria-label="Unchecked"
                  data-bounds="checkbox"
                />
                <Checkbox
                  aria-label="Checked"
                  defaultChecked
                  data-bounds="checked"
                />
                <Checkbox
                  aria-label="Indeterminate"
                  checked="indeterminate"
                  className="size-5 rounded-sm"
                  data-bounds="indeterminate"
                />
                <label htmlFor={`checkbox-${width}`} data-bounds="label">
                  Keep this label visible
                </label>
              </div>
              <div className="flex items-center gap-3">
                <SkeletonBox asChild>
                  <input
                    id={`native-${width}`}
                    type="checkbox"
                    className="size-4 appearance-none rounded-sm border"
                    data-bounds="native-checkbox"
                  />
                </SkeletonBox>
                <label htmlFor={`native-${width}`}>Native choice</label>
              </div>
              <div className="flex items-center gap-3" data-bounds="controls">
                <Input
                  aria-label="Name"
                  defaultValue="Draft"
                  className="max-w-48 min-w-0 flex-1"
                  data-bounds="input"
                />
                <Button
                  size="sm"
                  disabled
                  disabledReason="Finish editing first"
                  data-bounds="button"
                >
                  Save changes
                </Button>
              </div>
              <Input
                type="date"
                aria-label="Date"
                defaultValue="2026-09-14"
                data-bounds="date"
              />
              <Textarea
                aria-label="Notes"
                defaultValue="A note"
                rows={6}
                className="max-w-sm"
                data-bounds="textarea"
              />
              <Slider
                aria-label="Amount"
                value={50}
                min={0}
                max={100}
                onChange={() => {}}
                data-bounds="slider"
              />
              <div className="flex items-center gap-3" data-bounds="shapes">
                <SkeletonBox asChild>
                  <div
                    className="min-w-0 flex-1 rounded-xl p-3 text-sm"
                    data-bounds="flex-item"
                  >
                    This text wraps within the remaining width.
                  </div>
                </SkeletonBox>
                <SkeletonCircle asChild>
                  <span
                    className="block size-9 shrink-0 rounded-full"
                    data-bounds="circle"
                  />
                </SkeletonCircle>
                <Badge className="rounded-full" data-bounds="badge">
                  Active
                </Badge>
              </div>
              <p className="text-sm" data-bounds="text">
                Balance: <SkeletonBox>$12,480.55</SkeletonBox>
              </p>
              <div data-bounds="statistics">
                <StatCardGrid cols={2}>
                  <StatCard label="Requests" value="42" />
                  <StatCard label="Revenue" value="$12,480" />
                </StatCardGrid>
              </div>
            </div>
          </Skeletonize>
        ))}
      </div>
    </TooltipProvider>
  );
}

export const Geometry: Story = {
  render: () => <GeometryExample />,
  async play({ canvas, canvasElement, userEvent }) {
    await document.fonts.ready;
    const elements = Array.from(
      canvasElement.querySelectorAll<HTMLElement>('[data-bounds]'),
    );
    const before = elements.map((element) => ({
      element,
      rect: element.getBoundingClientRect().toJSON(),
      radius: getComputedStyle(element).borderRadius,
    }));
    const masks = Array.from(
      canvasElement.querySelectorAll<HTMLElement>('[data-skeleton-mask]'),
    );
    await expect(masks.length).toBeGreaterThan(20);
    for (const label of canvasElement.querySelectorAll('label')) {
      await userEvent.click(label);
    }
    for (const checkbox of canvasElement.querySelectorAll(
      '[data-bounds="checkbox"], [data-bounds="native-checkbox"]',
    )) {
      await expect(checkbox).not.toBeChecked();
    }
    for (const mask of masks) {
      await expect(mask.inert).toBe(true);
      mask.focus();
      await expect(document.activeElement).not.toBe(mask);
      await expect(getComputedStyle(mask).color).toBe('rgba(0, 0, 0, 0)');
      for (const child of mask.querySelectorAll('*')) {
        await expect(getComputedStyle(child).visibility).toBe('hidden');
      }
    }
    for (const slider of canvasElement.querySelectorAll(
      '[data-bounds="slider"]',
    )) {
      const inputRect = slider.getBoundingClientRect();
      const track = slider.parentElement?.querySelector(
        '[data-skeleton-mask="box"]',
      );
      const thumb = slider.parentElement?.querySelector(
        '[data-skeleton-mask="circle"]',
      );
      await expect(track).not.toBeNull();
      await expect(thumb).not.toBeNull();
      const trackRect = track?.getBoundingClientRect();
      const thumbRect = thumb?.getBoundingClientRect();
      await expect(trackRect?.width).toBe(inputRect.width);
      await expect(trackRect?.height).toBeLessThan(inputRect.height);
      await expect(thumbRect?.width).toBe(inputRect.height);
      await expect(thumbRect?.height).toBe(inputRect.height);
      await expect(thumbRect?.left).toBe(
        inputRect.left + (inputRect.width - inputRect.height) / 2,
      );
    }
    await userEvent.click(
      canvas.getByRole('button', { name: 'Toggle loading' }),
    );
    for (const { element, rect, radius } of before) {
      await expect(element.isConnected).toBe(true);
      await expect(element.getBoundingClientRect().toJSON()).toEqual(rect);
      await expect(getComputedStyle(element).borderRadius).toBe(radius);
    }
    await expect(
      canvasElement.querySelector('[data-skeleton-mask]'),
    ).toBeNull();
    for (const label of canvasElement.querySelectorAll('label')) {
      await userEvent.click(label);
    }
    for (const checkbox of canvasElement.querySelectorAll(
      '[data-bounds="checkbox"], [data-bounds="native-checkbox"]',
    )) {
      await expect(checkbox).toBeChecked();
    }
  },
};

export const GeometryDark: Story = {
  ...Geometry,
  globals: { theme: 'dark' },
};

export const SearchRows: Story = {
  render: () => (
    <div className="space-y-6">
      {[280, 760].flatMap((width) =>
        [false, true].map((showBreadcrumb) => (
          <div
            key={`${width}-${showBreadcrumb}`}
            style={{ width }}
            data-search-pair
          >
            <SearchSkeleton
              rows={1}
              showBreadcrumb={showBreadcrumb}
              reduceMotion
            />
            <ol className="px-2 py-3">
              <SearchResultRow
                result={{
                  id: 'example',
                  title: 'Example',
                  subtitle: 'A result preview',
                }}
                fallbackTerms={[]}
                isActive={false}
                onHover={() => {}}
                onSelect={() => {}}
                optionId={`example-${width}-${showBreadcrumb}`}
                refCallback={() => {}}
                getBreadcrumb={showBreadcrumb ? () => ['Docs'] : undefined}
              />
            </ol>
          </div>
        )),
      )}
    </div>
  ),
  async play({ canvasElement }) {
    await document.fonts.ready;
    for (const pair of canvasElement.querySelectorAll('[data-search-pair]')) {
      const [loading, loaded] = pair.querySelectorAll('li');
      await expect(loading?.getBoundingClientRect().height).toBe(
        loaded?.getBoundingClientRect().height,
      );
      await expect(loading?.getBoundingClientRect().width).toBe(
        loaded?.getBoundingClientRect().width,
      );
      for (const mask of pair.querySelectorAll(
        '[data-skeleton-mask], .animate-pulse',
      )) {
        await expect(getComputedStyle(mask).animationName).toBe('none');
      }
    }
  },
};
