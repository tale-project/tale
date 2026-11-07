import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SkeletonBox, SkeletonCircle, SkeletonText } from './skeleton';
import { Skeletonize } from './skeleton-context';

describe('SkeletonBox', () => {
  it('renders the real child untouched when not loading', () => {
    render(
      <SkeletonBox>
        <span data-testid="value">42</span>
      </SkeletonBox>,
    );
    expect(screen.getByTestId('value')).toHaveTextContent('42');
  });

  it('keeps the same text wrapper in both loading states', () => {
    const content = (loading: boolean) => (
      <Skeletonize loading={loading}>
        <SkeletonBox>42</SkeletonBox>
      </Skeletonize>
    );
    const { rerender } = render(content(false));
    const value = screen.getByText('42');
    const classes = value.className;
    rerender(content(true));
    expect(screen.getByText('42')).toBe(value);
    expect(value.className).toBe(classes);
  });

  it('adds no layout wrapper with asChild and forwards its ref and handlers', async () => {
    const ref = createRef<HTMLElement>();
    const onClick = vi.fn();
    const { container } = render(
      <SkeletonBox asChild ref={ref} onClick={onClick} data-state="closed">
        <button type="button">Open</button>
      </SkeletonBox>,
    );
    const button = screen.getByRole('button', { name: 'Open' });
    expect(container.firstElementChild).toBe(button);
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('data-state', 'closed');
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps the child mounted and hides the region while loading', () => {
    render(
      <Skeletonize loading>
        <SkeletonBox>
          <span data-testid="value">42</span>
        </SkeletonBox>
      </Skeletonize>,
    );
    // Foreground visibility comes from the mask stylesheet; the real content
    // stays in the same inert region throughout loading.
    const value = screen.getByTestId('value');
    expect(value).toBeInTheDocument();
    expect(value.parentElement).toHaveAttribute('data-skeleton-mask', 'box');
    expect(value.parentElement).toHaveAttribute('inert');
    expect(value.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves a control and its uncontrolled value when loading changes', () => {
    const control = createRef<HTMLInputElement>();
    const content = (loading: boolean) => (
      <Skeletonize loading={loading}>
        <SkeletonBox>
          <input ref={control} aria-label="Name" defaultValue="Saved" />
        </SkeletonBox>
      </Skeletonize>
    );
    const { rerender } = render(content(false));
    const input = control.current;
    expect(input).not.toBeNull();
    input!.value = 'Draft';

    rerender(content(true));
    expect(control.current).toBe(input);
    expect(control.current).toHaveValue('Draft');
    rerender(content(false));
    expect(control.current).toBe(input);
    expect(control.current).toHaveValue('Draft');
  });

  it('restores caller accessibility attributes when an asChild mask resolves', () => {
    const content = (loading: boolean) => (
      <Skeletonize loading={loading}>
        <SkeletonBox asChild>
          <button type="button" aria-disabled="true">
            Unavailable
          </button>
        </SkeletonBox>
      </Skeletonize>
    );
    const { rerender } = render(content(true));
    const button = screen.getByText('Unavailable');
    expect(button).toHaveAttribute('inert');
    expect(button).toHaveAttribute('aria-hidden', 'true');
    rerender(content(false));
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBe(button);
    expect(button).not.toHaveAttribute('inert');
    expect(button).not.toHaveAttribute('aria-hidden');
    expect(button).toHaveAttribute('aria-disabled', 'true');
  });

  it.each(['native', 'radix'] as const)(
    'blocks label-forwarded activation on a %s checkbox until loading resolves',
    async (kind) => {
      const onChange = vi.fn();
      const onClickCapture = vi.fn();
      const content = (loading: boolean) => (
        <Skeletonize loading={loading}>
          <label htmlFor="choice">Choose this option</label>
          <SkeletonBox asChild onClickCapture={onClickCapture}>
            {kind === 'native' ? (
              <input id="choice" type="checkbox" onChange={onChange} />
            ) : (
              <CheckboxPrimitive.Root id="choice" onCheckedChange={onChange} />
            )}
          </SkeletonBox>
        </Skeletonize>
      );
      const { rerender, user } = render(content(true));
      await user.click(screen.getByText('Choose this option'));
      expect(onChange).not.toHaveBeenCalled();
      expect(onClickCapture).not.toHaveBeenCalled();

      rerender(content(false));
      await user.click(screen.getByText('Choose this option'));
      expect(onChange).toHaveBeenCalledOnce();
      expect(onClickCapture).toHaveBeenCalledOnce();
      expect(screen.getByRole('checkbox')).toBeChecked();
    },
  );
});

describe('SkeletonCircle', () => {
  it('wraps round content and is decorative while loading', () => {
    render(
      <Skeletonize loading>
        <SkeletonCircle>
          <span data-testid="avatar" className="block size-9" />
        </SkeletonCircle>
      </Skeletonize>,
    );
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
  });
});

describe('SkeletonText', () => {
  it('renders a single line by default', () => {
    const { container } = render(<SkeletonText />);
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('renders `lines` lines', () => {
    const { container } = render(<SkeletonText lines={3} />);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = render(<SkeletonText lines={2} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes axe audit', async () => {
    const { container } = render(<SkeletonText lines={3} />);
    await checkAccessibility(container);
  });
});
