import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Avatar, getInitials } from './avatar';

describe('getInitials', () => {
  it.each([
    ['Anna Meier', 'AM'],
    ['Anna Maria Meier', 'AM'],
    ['jordan', 'J'],
    ['anna.meier@example.com', 'AM'],
    ['yara_polish', 'YP'],
    ['  élodie   durand ', 'ÉD'],
    ['', ''],
    ['   ', ''],
  ])('reads %j as %j', (name, initials) => {
    expect(getInitials(name)).toBe(initials);
  });
});

describe('Avatar', () => {
  it('is a named image with a tooltip when labelled', () => {
    render(<Avatar name="Anna Meier" label="Anna Meier" />);
    const avatar = screen.getByRole('img', { name: 'Anna Meier' });
    expect(avatar).toHaveAttribute('title', 'Anna Meier');
    expect(avatar).toHaveTextContent('AM');
  });

  it('is decorative without a label', () => {
    const { container } = render(<Avatar name="Anna Meier" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives the same person the same tint every time', () => {
    const { container, rerender } = render(<Avatar name="Sarah Johnson" />);
    const first = container.firstElementChild?.className;
    rerender(<Avatar name="Sarah Johnson" />);
    expect(container.firstElementChild?.className).toBe(first);
    expect(first).toMatch(/bg-\w+-500\/15/);
  });

  it.each([
    ['agent', 'bg-primary/10'],
    ['automation', 'bg-muted'],
    ['system', 'bg-muted'],
  ] as const)('draws a %s as a glyph on its tone', (kind, tone) => {
    render(<Avatar kind={kind} name="Ignored Name" label="Actor" />);
    const avatar = screen.getByRole('img', { name: 'Actor' });
    expect(avatar).toHaveClass(tone);
    expect(avatar).not.toHaveTextContent('IN');
    expect(avatar.querySelector('svg')).toBeInTheDocument();
  });

  it('draws an empty slot with a dashed border', () => {
    render(<Avatar kind="unassigned" label="Unassigned" />);
    expect(screen.getByRole('img', { name: 'Unassigned' })).toHaveClass(
      'border-dashed',
    );
  });

  it('falls back to a glyph for a person with no name', () => {
    render(<Avatar label="Someone" />);
    const avatar = screen.getByRole('img', { name: 'Someone' });
    expect(avatar.querySelector('svg')).toBeInTheDocument();
    expect(avatar).toHaveClass('bg-muted');
  });

  it('lets the host override the tone', () => {
    render(<Avatar name="Alex" label="Alex" tone="strong" />);
    expect(screen.getByRole('img', { name: 'Alex' })).toHaveClass(
      'bg-primary',
      'text-primary-foreground',
    );
  });

  it.each([
    ['xs', 'size-5'],
    ['sm', 'size-6'],
    ['md', 'size-7'],
    ['lg', 'size-8'],
  ] as const)('sizes %s as %s', (size, cls) => {
    render(<Avatar name="Anna" label="Anna" size={size} />);
    expect(screen.getByRole('img', { name: 'Anna' })).toHaveClass(cls);
  });

  it('shows a picture and falls back to initials when it fails', () => {
    const { container } = render(
      <Avatar name="Anna Meier" label="Anna Meier" src="/missing.png" />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    fireEvent.error(image as HTMLImageElement);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Anna Meier' })).toHaveTextContent(
      'AM',
    );
  });

  it('forwards attributes and classes', () => {
    render(
      <Avatar
        name="Anna"
        label="Anna"
        data-testid="who"
        className="ring-background ring-2"
      />,
    );
    expect(screen.getByTestId('who')).toHaveClass('ring-2');
  });

  it('passes an axe audit, named and decorative', async () => {
    const { container } = render(
      <div>
        <Avatar name="Anna Meier" label="Anna Meier" />
        <Avatar kind="agent" label="Research Bot" />
        <Avatar kind="unassigned" label="Unassigned" />
        <Avatar name="Kim Lee" />
      </div>,
    );
    await checkAccessibility(container);
  });
});
