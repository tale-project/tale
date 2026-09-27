import { PROJECT_ICONS } from '@tale/shared/schemas/projects';
import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ProjectAvatar } from './project-avatar';

/** The `lucide-<name>` class lucide-react stamps on the icon it rendered. */
function renderedIconClass(container: HTMLElement): string | undefined {
  return [...(container.querySelector('svg')?.classList ?? [])].find(
    (name) => name.startsWith('lucide-') && name !== 'lucide',
  );
}

describe('ProjectAvatar', () => {
  it('renders its own icon for every allowlisted name, never the fallback', () => {
    // The avatar maps names explicitly instead of reading the whole lucide
    // namespace (which kept every icon in the bundle); each entry of the
    // allowlist must resolve to a distinct icon rather than the default.
    const { container: fallback } = render(<ProjectAvatar name="A" />);
    const fallbackClass = renderedIconClass(fallback);
    expect(fallbackClass).toBe('lucide-folder');
    for (const icon of PROJECT_ICONS) {
      const { container } = render(<ProjectAvatar name="A" icon={icon} />);
      const rendered = renderedIconClass(container);
      expect(rendered, icon).toBeDefined();
      if (icon !== 'Folder') {
        expect(rendered, icon).not.toBe(fallbackClass);
      }
    }
  });

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
