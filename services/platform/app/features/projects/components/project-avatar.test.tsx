import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { ProjectAvatar } from './project-avatar';

describe('ProjectAvatar', () => {
  it('renders with the project name as aria-label', () => {
    const { container } = render(
      <ProjectAvatar name="Q2 Sales Hiring" icon="Briefcase" color="emerald" />,
    );
    expect(container.querySelector('[aria-label="Q2 Sales Hiring"]')).not.toBe(
      null,
    );
  });

  it('falls back to the default icon when icon name is unknown', () => {
    // No throw — the resolver falls back to FolderKanban silently.
    expect(() =>
      render(<ProjectAvatar name="Test" icon="DefinitelyNotAnIcon" />),
    ).not.toThrow();
  });

  it('falls back to the default color token when unknown', () => {
    expect(() =>
      render(<ProjectAvatar name="Test" color="mauve" />),
    ).not.toThrow();
  });

  it('accepts null and undefined for icon and color', () => {
    expect(() =>
      render(<ProjectAvatar name="A" icon={null} color={null} />),
    ).not.toThrow();
    expect(() =>
      render(<ProjectAvatar name="A" icon={undefined} color={undefined} />),
    ).not.toThrow();
  });

  it('renders each documented size without throwing', () => {
    const sizes: Array<16 | 20 | 24 | 32> = [16, 20, 24, 32];
    for (const size of sizes) {
      expect(() =>
        render(<ProjectAvatar name="A" size={size} />),
      ).not.toThrow();
    }
  });

  it('uses role="img" so screen readers announce it as an image', () => {
    render(<ProjectAvatar name="My Project" />);
    expect(screen.getByRole('img', { name: 'My Project' })).not.toBe(null);
  });

  describe('accessibility', () => {
    it('passes axe audit with default props', async () => {
      const { container } = render(<ProjectAvatar name="Default" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with custom icon + color', async () => {
      const { container } = render(
        <ProjectAvatar name="Custom" icon="Rocket" color="blue" size={32} />,
      );
      await checkAccessibility(container);
    });
  });
});
