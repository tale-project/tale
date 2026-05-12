import { Puzzle } from 'lucide-react';
import type { ComponentType } from 'react';

import { CirculyIcon } from '@/app/components/icons/circuly-icon';
import { GmailIcon } from '@/app/components/icons/gmail-icon';
import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { OneDriveIcon } from '@/app/components/icons/onedrive-icon';
import { OutlookIcon } from '@/app/components/icons/outlook-icon';
import { ProtelIcon } from '@/app/components/icons/protel-icon';
import { SharePointIcon } from '@/app/components/icons/sharepoint-icon';
import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
import { TaleLogoIcon } from '@/app/components/icons/tale-logo-icon';

type BrandIcon = ComponentType<{ className?: string }>;

const BRAND_ICONS: Record<string, BrandIcon> = {
  tale: TaleLogoIcon,
  gmail: GmailIcon,
  outlook: OutlookIcon,
  microsoft: MicrosoftIcon,
  teams: MicrosoftIcon,
  onedrive: OneDriveIcon,
  sharepoint: SharePointIcon,
  shopify: ShopifyIcon,
  circuly: CirculyIcon,
  protel: ProtelIcon,
};

export function getIntegrationBrandIcon(name: string): BrandIcon {
  return BRAND_ICONS[name.toLowerCase()] ?? Puzzle;
}
