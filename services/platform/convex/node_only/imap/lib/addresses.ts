'use node';

import type { AddressObject } from 'mailparser';

export type SimpleAddress = { name?: string; address: string };

// Extract address list from mailparser's AddressObject into a simple array
export default function extractAddresses(
  addressObj: AddressObject | AddressObject[] | undefined,
): Array<SimpleAddress> {
  if (!addressObj) return [];
  const objs = Array.isArray(addressObj) ? addressObj : [addressObj];
  const result: Array<SimpleAddress> = [];
  for (const obj of objs) {
    if (obj.value) {
      for (const addr of obj.value) {
        if (addr.address) {
          result.push({ name: addr.name, address: addr.address });
        }
      }
    }
  }
  return result;
}
