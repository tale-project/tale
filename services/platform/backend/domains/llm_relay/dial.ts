import dns from 'node:dns';
import type { LookupFunction } from 'node:net';

import { isMetadataAddress, isPrivateIp } from '@tale/shared/net/private-ip';

import { privateProviderHostsAllowed } from '../../../lib/net/host-policy.ts';

/** A provider's name resolved to an address the provider host policy
 * refuses, or to none: the call is never connected. */
export class ProviderAddressRefused extends Error {
  readonly code = 'EPROVIDERADDRESS';

  constructor(message: string) {
    super(message);
    this.name = 'ProviderAddressRefused';
  }
}

/**
 * The relay's resolution of a provider's name at the dial, held to the
 * provider host policy its URL was held to before the call
 * (`checkProviderHostPolicy`, tale-project/tale#4942): never a cloud metadata
 * address, and a private, loopback or link-local one only where the operator
 * admitted private provider hosts (`TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1`).
 * Every address the name answers is judged, and the socket connects to the
 * ones judged here, so a name whose record points inside the network is
 * refused, also where the backend's egress fence is not installed (a
 * container without NET_ADMIN). An address written in the URL is not
 * resolved: the URL's check judged it.
 */
export const providerLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) {
      callback(error, '', undefined);
      return;
    }
    const addresses = Array.isArray(found) ? found : [];
    const refused = addresses.find(
      ({ address }) =>
        isMetadataAddress(address) ||
        (!privateProviderHostsAllowed() && isPrivateIp(address)),
    );
    const first = addresses[0];
    if (refused !== undefined || first === undefined) {
      callback(
        new ProviderAddressRefused(
          refused === undefined
            ? `provider host ${hostname} resolved to no address`
            : `provider host ${hostname} resolves to ${refused.address}, which the provider host policy refuses`,
        ),
        '',
        undefined,
      );
      return;
    }
    if (options.all === true) {
      callback(null, addresses);
      return;
    }
    callback(null, first.address, first.family);
  });
};
