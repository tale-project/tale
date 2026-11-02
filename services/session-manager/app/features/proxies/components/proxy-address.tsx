import { Text } from '@tale/ui/text';

import type { Proxy } from '@/lib/api/schemas';

import { addressPrefixOf, hostPortOf } from '../lib/address';

/**
 * `scheme://[user@]host:port`: the front muted, the host and port as the name
 * of the row. It wraps and is never cut short, since the port may be what tells
 * two proxies apart and a title is not on a keyboard or a touch screen: the
 * line breaks between the front and the host first, and inside a host or an
 * IPv6 address only when it must. The password is nowhere in it: the API does
 * not have one to send.
 */
export function ProxyAddress({ proxy }: { proxy: Proxy }) {
  return (
    <span className="min-w-0 wrap-anywhere">
      <Text as="span" variant="muted">
        {addressPrefixOf(proxy)}
      </Text>
      <wbr />
      <Text as="span" variant="label">
        {hostPortOf(proxy)}
      </Text>
    </span>
  );
}
