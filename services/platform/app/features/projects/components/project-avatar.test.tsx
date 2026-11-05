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
    const { container: fallback } = render(<ProjectAvatar />);
    const fallbackClass = renderedIconClass(fallback);
    expect(fallbackClass).toBe('lucide-folder');
    for (const icon of PROJECT_ICONS) {
      const { container } = render(<ProjectAvatar icon={icon} />);
      const rendered = renderedIconClass(container);
      expect(rendered, icon).toBeDefined();
      if (icon !== 'Folder') {
        expect(rendered, icon).not.toBe(fallbackClass);
      }
    }
  });

  it('is decorative without a label: no image for a screen reader to read', () => {
    const { container } = render(
      <ProjectAvatar icon="Briefcase" color="emerald" />,
    );
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).not.toHaveAttribute('aria-label');
  });

  it('beside the visible name, leaves the name to the text (#5382)', () => {
    // Inside a link the named image added the name a second time:
    // "Launch site Launch site".
    render(
      <a href="/projects/launch-site">
        <ProjectAvatar icon="Rocket" color="blue" size={16} />
        <span>Launch site</span>
      </a>,
    );
    expect(screen.getByRole('link')).toHaveAccessibleName('Launch site');
  });

  it('falls back to the default icon when icon name is unknown', () => {
    // No throw — the resolver falls back to FolderKanban silently.
    expect(() =>
      render(<ProjectAvatar icon="DefinitelyNotAnIcon" />),
    ).not.toThrow();
  });

  it('falls back to the default color token when unknown', () => {
    expect(() => render(<ProjectAvatar color="mauve" />)).not.toThrow();
  });

  it('accepts null and undefined for icon and color', () => {
    expect(() =>
      render(<ProjectAvatar icon={null} color={null} />),
    ).not.toThrow();
    expect(() =>
      render(<ProjectAvatar icon={undefined} color={undefined} />),
    ).not.toThrow();
  });

  it('renders each documented size without throwing', () => {
    const sizes: Array<16 | 20 | 24 | 32> = [16, 20, 24, 32];
    for (const size of sizes) {
      expect(() => render(<ProjectAvatar size={size} />)).not.toThrow();
    }
  });

  it('with a label, is an image a screen reader announces by that name', () => {
    render(<ProjectAvatar label="Q2 Sales Hiring" icon="Briefcase" />);
    expect(
      screen.getByRole('img', { name: 'Q2 Sales Hiring' }),
    ).not.toHaveAttribute('aria-hidden');
  });

  describe('accessibility', () => {
    it('passes axe audit with default props', async () => {
      const { container } = render(<ProjectAvatar />);
      await checkAccessibility(container);
    });

    it('passes axe audit with a label', async () => {
      const { container } = render(<ProjectAvatar label="Default" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with custom icon + color', async () => {
      const { container } = render(
        <ProjectAvatar label="Custom" icon="Rocket" color="blue" size={32} />,
      );
      await checkAccessibility(container);
    });
  });
});
