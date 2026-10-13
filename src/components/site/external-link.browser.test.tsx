import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { ExternalLink } from './external-link';

import '../../globals.css';

afterEach(() => {
  cleanup();
});

// A marketing footer column is half a phone wide (~126px at 320). The link
// used to be `whitespace-nowrap`, so "Hardware Agreement ↗" ran past the
// column and off the screen. Whether a label wraps is layout — only a real
// engine answers it.
describe('ExternalLink in a narrow column (real layout)', () => {
  it('wraps a long label inside the column and keeps the icon beside it', () => {
    render(
      <div style={{ width: 110 }}>
        <ExternalLink href="https://example.com" className="text-sm">
          Hardware Agreement
        </ExternalLink>
      </div>,
    );
    const link = screen.getByRole('link', { name: /Hardware Agreement/ });
    const column = link.parentElement as HTMLElement;
    const icon = link.querySelector('svg');
    if (!icon) throw new Error('no icon');
    expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(
      column.getBoundingClientRect().right + 0.5,
    );
    expect(icon.getBoundingClientRect().right).toBeLessThanOrEqual(
      column.getBoundingClientRect().right + 0.5,
    );
    // The label took a second line rather than overflowing.
    const lineHeight = Number.parseFloat(getComputedStyle(link).lineHeight);
    expect(link.getBoundingClientRect().height).toBeGreaterThan(
      lineHeight * 1.5,
    );
    // The icon stays in the link's own row (the flex row), not on a line
    // below the label.
    expect(icon.getBoundingClientRect().left).toBeGreaterThan(
      link.getBoundingClientRect().left + 40,
    );
  });

  it('keeps a short label and its icon on one line', () => {
    render(
      <div style={{ width: 300 }}>
        <ExternalLink href="https://example.com" className="text-sm">
          Docs
        </ExternalLink>
      </div>,
    );
    const link = screen.getByRole('link', { name: /Docs/ });
    const lineHeight = Number.parseFloat(getComputedStyle(link).lineHeight);
    expect(link.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
  });
});
