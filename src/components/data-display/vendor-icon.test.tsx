import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import { VendorIcon } from './vendor-icon';

describe('VendorIcon', () => {
  it("shows the vendor's icon as decoration", () => {
    const { container } = render(<VendorIcon iconUrl="/icons/github.svg" />);
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', '/icons/github.svg');
    expect(image).toHaveAttribute('alt', '');
  });

  it('falls back to the plug glyph without an icon or when it fails to load', () => {
    const { container, rerender } = render(<VendorIcon />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    rerender(<VendorIcon iconUrl="/icons/broken.svg" />);
    const image = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();

    // Another vendor's icon gets its own attempt.
    rerender(<VendorIcon iconUrl="/icons/slack.svg" />);
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/icons/slack.svg',
    );
  });
});
