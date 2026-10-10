import { VendorIcon } from '@tale/ui/vendor-icon';

/**
 * An image the browser cannot decode: it fails at once, with no request and
 * no 404 in the console, as a vendor icon that fails to load would.
 */
const BROKEN_ICON = 'data:image/svg+xml,%3Csvg';

export default function FoundationsVendorIcon() {
  return (
    <ul className="flex flex-col gap-3 text-sm">
      <li className="flex items-center gap-2">
        <VendorIcon iconUrl="/favicon-light.png" />
        <span>Tale (the vendor's own icon)</span>
      </li>
      <li className="flex items-center gap-2">
        <VendorIcon />
        <span>WebDAV (ships no icon)</span>
      </li>
      <li className="flex items-center gap-2">
        <VendorIcon iconUrl={BROKEN_ICON} />
        <span>Example API (its icon failed to load)</span>
      </li>
    </ul>
  );
}
