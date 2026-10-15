import { BrandIcon } from '@tale/ui/brand-icon';
import { Webhook } from 'lucide-react';

const PRODUCTS = [
  { brand: 'github', name: 'GitHub' },
  { brand: 'glitchtip', name: 'GlitchTip' },
  { brand: 'forgejo', name: 'Forgejo' },
  { brand: 'gmail', name: 'Gmail' },
  { brand: 'outlook', name: 'Outlook' },
  { brand: 'imap-smtp', name: 'IMAP / SMTP' },
  { brand: 'slack', name: 'Slack' },
  { brand: 'google-drive', name: 'Google Drive' },
  { brand: 'onedrive', name: 'OneDrive' },
  { brand: 'sharepoint', name: 'SharePoint' },
  { brand: 'microsoft', name: 'Microsoft' },
  { brand: 'shopify', name: 'Shopify' },
  { brand: 'example-crm', name: 'Example CRM (no logo)' },
  { brand: 'webhook', name: 'Webhook (its own fallback)', fallback: Webhook },
];

/**
 * Every product logo, each with its name and slug beside it — the logo is
 * hidden from assistive technology, so the name is what a screen reader
 * reads. The last two slugs have no logo: one shows the puzzle piece, the
 * other the Lucide icon passed as its `fallback`.
 */
export default function FoundationsBrandIcon() {
  return (
    <ul className="grid w-full grid-cols-2 gap-4 text-sm sm:grid-cols-3">
      {PRODUCTS.map((product) => (
        <li key={product.brand} className="flex items-center gap-2">
          <BrandIcon brand={product.brand} fallback={product.fallback} />
          <span className="flex min-w-0 flex-col">
            <span>{product.name}</span>
            <code className="text-muted-foreground text-xs">
              {product.brand}
            </code>
          </span>
        </li>
      ))}
    </ul>
  );
}
