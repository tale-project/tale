'use client';

import type { LucideIcon } from 'lucide-react';
import { Puzzle } from 'lucide-react';
import type { ComponentType } from 'react';

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
import { cn } from '../../lib/cn';

/**
 * The products Tale draws a logo for, by slug: the brands an automation
 * manifest may name as `brand:<slug>`, in the same order. Keep the list in
 * step with `AUTOMATION_BRAND_ICONS` in `@tale/shared/schemas/automation-pack`,
 * which this package cannot import.
 */
export const BRAND_ICON_SLUGS = [
  'github',
  'glitchtip',
  'gmail',
  'outlook',
  'imap-smtp',
  'slack',
  'google-drive',
  'onedrive',
  'sharepoint',
  'microsoft',
  'shopify',
] as const;

export type BrandIconSlug = (typeof BRAND_ICON_SLUGS)[number];

const SLUGS: ReadonlySet<string> = new Set(BRAND_ICON_SLUGS);

/** Whether Tale draws a logo for this slug. */
export function isBrandIconSlug(value: string): value is BrandIconSlug {
  return SLUGS.has(value);
}

const MARKS: Record<BrandIconSlug, ComponentType<{ className?: string }>> = {
  github: GithubIcon,
  glitchtip: GlitchTipIcon,
  gmail: GmailIcon,
  outlook: OutlookIcon,
  'imap-smtp': MailServerIcon,
  slack: SlackIcon,
  'google-drive': GoogleDriveIcon,
  onedrive: OneDriveIcon,
  sharepoint: SharePointIcon,
  microsoft: MicrosoftIcon,
  shopify: ShopifyIcon,
};

/**
 * Every mark hides itself and takes its size from the class it is given,
 * except Gmail's and Outlook's, which carry no `aria-hidden`: those two sit in
 * a hidden span that takes the size, and the mark fills it.
 */
const MARKS_IN_HIDDEN_SPAN: ReadonlySet<BrandIconSlug> = new Set([
  'gmail',
  'outlook',
]);

/**
 * `@tale/ui/brand-icon` — a product's logo, named by its slug: `gmail` for an
 * automation template whose icon is `brand:gmail`. A slug Tale draws no logo
 * for shows a Lucide glyph instead, the puzzle piece unless you pass
 * `fallback`. Decorative either way: the product's name sits right next to it,
 * so the logo is hidden from assistive technology instead of saying the name
 * twice. `size-5` unless the `className` sizes it.
 */
export function BrandIcon({
  brand,
  className,
  fallback: Fallback = Puzzle,
}: {
  brand: string;
  className?: string;
  fallback?: LucideIcon;
}) {
  if (!isBrandIconSlug(brand)) {
    return (
      <Fallback
        aria-hidden
        className={cn('text-muted-foreground size-5 shrink-0', className)}
      />
    );
  }

  const Mark = MARKS[brand];
  const sized = cn('size-5 shrink-0', className);
  if (MARKS_IN_HIDDEN_SPAN.has(brand)) {
    return (
      <span aria-hidden className={cn('block', sized)}>
        <Mark />
      </span>
    );
  }
  return <Mark className={sized} />;
}
