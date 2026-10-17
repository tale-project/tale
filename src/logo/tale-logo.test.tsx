import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaleLogo } from './tale-logo';

describe('TaleLogo', () => {
  it('renders the wordmark with the wide viewBox', () => {
    const { container } = render(<TaleLogo />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 73.65 20');
    expect(container.querySelectorAll('path').length).toBeGreaterThan(2);
  });

  it('renders the mark-only glyph inside the 20×20 viewBox', () => {
    const { container } = render(<TaleLogo wordmark={false} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 20');
    const path = container.querySelector('path');
    expect(path?.getAttribute('d')).toContain('M5.53 14.987');
    // No nested design-space transforms — those clip into a blob at 20×20.
    expect(container.querySelector('g')).toBeNull();
  });
});
