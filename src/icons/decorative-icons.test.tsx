import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EnterKeyIcon } from './enter-key-icon';
import { LocaleIcon } from './locale-icon';
import { ShopifyIcon } from './shopify-icon';
import { WebsiteIcon } from './website-icon';

describe.each([
  ['Enter', EnterKeyIcon],
  ['Locale', LocaleIcon],
  ['Shopify', ShopifyIcon],
  ['Website', WebsiteIcon],
])('%s icon', (name, Icon) => {
  it('is decorative by default and exposes an explicit accessible name', () => {
    const view = render(<Icon />);
    const svg = view.container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('aria-label');
    expect(svg).not.toHaveAccessibleName();

    view.rerender(<Icon label={name} />);
    expect(svg).not.toHaveAttribute('aria-hidden');
    expect(svg).toHaveAccessibleName(name);

    view.rerender(<Icon label="" />);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
