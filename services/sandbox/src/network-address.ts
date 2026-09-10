import { Address4 } from 'ip-address';

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map(
  (subnet) => new Address4(subnet),
);

/** Pure address validation shared by both execution backends. */
export function ipv4Subnet(value: unknown): Address4 {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(value)) {
    throw new Error('network: invalid IPv4 subnet');
  }
  const address = new Address4(value);
  if (address.correctForm() !== address.startAddress().correctForm()) {
    throw new Error('network: subnet has nonzero host bits');
  }
  return address;
}

export function subnetsOverlap(a: Address4, b: Address4): boolean {
  return a.isInSubnet(b) || b.isInSubnet(a);
}

export function isPrivateIpv4Subnet(address: Address4): boolean {
  return PRIVATE_RANGES.some((range) => address.isInSubnet(range));
}

export function parseDindInnerPool(value: unknown): string {
  try {
    const address = ipv4Subnet(value);
    if (address.subnetMask !== 16 || !isPrivateIpv4Subnet(address))
      throw new Error('Invalid inner pool');
    return address.address;
  } catch (cause) {
    throw new Error(
      'SANDBOX_DIND_INNER_POOL must be a canonical RFC1918 IPv4 /16 subnet',
      { cause },
    );
  }
}
