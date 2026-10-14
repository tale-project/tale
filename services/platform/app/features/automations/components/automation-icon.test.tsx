import { AUTOMATION_BRAND_ICONS } from '@tale/shared/schemas/automation-pack';
import { BRAND_ICON_SLUGS } from '@tale/ui/brand-icon';
import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { AutomationIcon } from './automation-icon';

describe('AutomationIcon', () => {
  it('draws every brand a manifest may name as the product’s own logo', () => {
    // The shared schema accepts exactly the logos the app can draw.
    expect([...AUTOMATION_BRAND_ICONS].sort()).toEqual(
      [...BRAND_ICON_SLUGS].sort(),
    );
    for (const brand of AUTOMATION_BRAND_ICONS) {
      const { container, unmount } = render(
        <AutomationIcon icon={`brand:${brand}`} />,
      );
      expect(container.querySelector('svg'), brand).not.toBeNull();
      expect(container.querySelector('svg.lucide-puzzle'), brand).toBeNull();
      unmount();
    }
  });

  it('draws a lucide name as its glyph, and nothing declared as the neutral one', () => {
    const glyph = render(<AutomationIcon icon="webhook" />);
    expect(glyph.container.querySelector('svg.iconify--lucide')).not.toBeNull();
    glyph.unmount();
    const none = render(<AutomationIcon icon={undefined} />);
    expect(none.container.querySelector('svg.lucide-sparkles')).not.toBeNull();
  });

  it('falls back for a brand it has no logo for, never drawing a lucide glyph of that name', () => {
    const { container } = render(<AutomationIcon icon="brand:nowhere" />);
    expect(container.querySelector('svg.lucide-puzzle')).not.toBeNull();
    expect(container.querySelector('svg.iconify--lucide')).toBeNull();
  });

  it('is decoration: the name beside it says what it is', () => {
    const { container } = render(<AutomationIcon icon="brand:github" />);
    const svg = container.querySelector('svg');
    expect(svg?.closest('[aria-hidden="true"]') ?? svg).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});
