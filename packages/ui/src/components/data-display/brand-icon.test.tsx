import { render } from '@testing-library/react';
import { Webhook } from 'lucide-react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { GithubIcon } from '../../icons/github-icon';
import { GlitchTipIcon } from '../../icons/glitchtip-icon';
import { GmailIcon } from '../../icons/gmail-icon';
import { GoogleDriveIcon } from '../../icons/google-drive-icon';
import { MailServerIcon } from '../../icons/mail-server-icon';
import { MicrosoftIcon } from '../../icons/microsoft-icon';
import { OneDriveIcon } from '../../icons/onedrive-icon';
import { OutlookIcon } from '../../icons/outlook-icon';
import { SharePointIcon } from '../../icons/sharepoint-icon';
import { ShopifyIcon } from '../../icons/shopify-icon';
import { SlackIcon } from '../../icons/slack-icon';
import type { BrandIconSlug } from './brand-icon';
import { BRAND_ICON_SLUGS, BrandIcon, isBrandIconSlug } from './brand-icon';

/** Which mark each slug must draw, stated apart from the component's own table. */
const EXPECTED: {
  brand: BrandIconSlug;
  Mark: ComponentType<{ className?: string }>;
}[] = [
  { brand: 'github', Mark: GithubIcon },
  { brand: 'glitchtip', Mark: GlitchTipIcon },
  { brand: 'gmail', Mark: GmailIcon },
  { brand: 'outlook', Mark: OutlookIcon },
  { brand: 'imap-smtp', Mark: MailServerIcon },
  { brand: 'slack', Mark: SlackIcon },
  { brand: 'google-drive', Mark: GoogleDriveIcon },
  { brand: 'onedrive', Mark: OneDriveIcon },
  { brand: 'sharepoint', Mark: SharePointIcon },
  { brand: 'microsoft', Mark: MicrosoftIcon },
  { brand: 'shopify', Mark: ShopifyIcon },
];

describe('BrandIcon', () => {
  it('has an expected mark for every slug', () => {
    expect(EXPECTED.map(({ brand }) => brand)).toEqual([...BRAND_ICON_SLUGS]);
  });

  it.each(EXPECTED)(
    'draws the $brand logo, hidden from assistive technology',
    ({ brand, Mark }) => {
      const { container } = render(<BrandIcon brand={brand} />);
      const root = container.firstElementChild;
      const svg = container.querySelector('svg');
      const own = render(<Mark />).container.querySelector('svg');

      expect(svg).not.toBeNull();
      expect(svg?.innerHTML).toBe(own?.innerHTML);
      expect(root).toHaveAttribute('aria-hidden', 'true');
      expect(root).toHaveClass('size-5', 'shrink-0');
      // The logo is the sized box, or fills the hidden span that is.
      expect(svg === root || svg?.classList.contains('size-full')).toBe(true);
    },
  );

  it.each(BRAND_ICON_SLUGS)('lets a class size the %s logo', (brand) => {
    const { container } = render(
      <BrandIcon brand={brand} className="size-8" />,
    );
    const root = container.firstElementChild;
    expect(root).toHaveClass('size-8', 'shrink-0');
    expect(root).not.toHaveClass('size-5');
  });

  it('draws GlitchTip in a purple a dark tile still shows', () => {
    // The brand's #681C89 reads at about 1.5:1 on the dark muted tile; the
    // lighter purple of the same hue reads at about 6.6:1 (WCAG 1.4.11).
    const { container } = render(<BrandIcon brand="glitchtip" />);
    expect(container.querySelector('g')).toHaveClass(
      'stroke-[#681C89]',
      'dark:stroke-[#C79BE0]',
    );
  });

  it('shows the muted puzzle piece for a slug it draws no logo for', () => {
    const { container } = render(<BrandIcon brand="gitlab" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass(
      'lucide-puzzle',
      'text-muted-foreground',
      'size-5',
      'shrink-0',
    );
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the fallback it is given, sized by its class', () => {
    const { container } = render(
      <BrandIcon brand="brand:gmail" fallback={Webhook} className="size-8" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass(
      'lucide-webhook',
      'text-muted-foreground',
      'size-8',
    );
    expect(svg).not.toHaveClass('size-5');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('isBrandIconSlug', () => {
  it.each(BRAND_ICON_SLUGS)('knows %s', (slug) => {
    expect(isBrandIconSlug(slug)).toBe(true);
  });

  it.each(['gitlab', 'brand:gmail', 'Gmail', '', 'toString'])(
    'refuses %j',
    (value) => {
      expect(isBrandIconSlug(value)).toBe(false);
    },
  );
});
