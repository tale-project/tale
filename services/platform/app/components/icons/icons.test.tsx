import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CirculyIcon } from './circuly-icon';
import { EnterKeyIcon } from './enter-key-icon';
import { GmailIcon } from './gmail-icon';
import { LocaleIcon } from './locale-icon';
import { MicrosoftIcon } from './microsoft-icon';
import { OneDriveIcon } from './onedrive-icon';
import { OutlookIcon } from './outlook-icon';
import { ProtelIcon } from './protel-icon';
import { SharePointIcon } from './sharepoint-icon';
import { ShopifyIcon } from './shopify-icon';
import { WebsiteIcon } from './website-icon';

const icons = [
  { name: 'CirculyIcon', Component: CirculyIcon },
  { name: 'EnterKeyIcon', Component: EnterKeyIcon },
  { name: 'GmailIcon', Component: GmailIcon },
  { name: 'LocaleIcon', Component: LocaleIcon },
  { name: 'MicrosoftIcon', Component: MicrosoftIcon },
  { name: 'OneDriveIcon', Component: OneDriveIcon },
  { name: 'OutlookIcon', Component: OutlookIcon },
  { name: 'ProtelIcon', Component: ProtelIcon },
  { name: 'SharePointIcon', Component: SharePointIcon },
  { name: 'ShopifyIcon', Component: ShopifyIcon },
  { name: 'WebsiteIcon', Component: WebsiteIcon },
];

describe('Icons', () => {
  describe('accessibility', () => {
    it.each(icons)('$name passes axe audit', async ({ Component }) => {
      const { container } = render(
        <span aria-hidden="true">
          <Component />
        </span>,
      );
      await checkAccessibility(container);
    });
  });
});
