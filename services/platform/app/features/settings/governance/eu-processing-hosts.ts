/**
 * The hosts an admin attests as processing in the EU/EEA, as the model
 * access editor takes them: one per line, checked the way the policy save
 * checks them (`checkGovernancePolicy`), so the editor names a problem
 * before a save would be refused.
 */

import {
  EU_PROCESSING_HOSTS_MAX,
  isEndpointHost,
} from '@tale/shared/schemas/governance';

import { isAttestableEndpointHost, vendorEuEndpoint } from '@/lib/chat/serving';

/** The hosts typed into the list: trimmed, lowercase, blank lines and
 * repeats dropped. */
export function parseHostLines(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0),
    ),
  ];
}

/** Why a list of hosts cannot be saved. */
export type HostListProblem =
  /** Not a host as a URL names it — a scheme, a port, a path or a wildcard
   * is part of the line. */
  | { readonly kind: 'invalid'; readonly host: string }
  /** A host of a vendor whose EU endpoint is known, which the rule counts
   * only as that endpoint, attested or not. */
  | {
      readonly kind: 'vendor';
      readonly host: string;
      readonly euHost: string;
    }
  | { readonly kind: 'tooMany'; readonly max: number };

/** The first problem with `hosts`, or undefined when the list saves. */
export function hostListProblem(
  hosts: readonly string[],
): HostListProblem | undefined {
  for (const host of hosts) {
    if (!isEndpointHost(host)) return { kind: 'invalid', host };
    if (isAttestableEndpointHost(host)) continue;
    const euHost = vendorEuEndpoint(host);
    // A host a URL writes differently (`127.1` for `127.0.0.1`) is no host
    // as the rule reads it either.
    return euHost === undefined
      ? { kind: 'invalid', host }
      : { kind: 'vendor', host, euHost };
  }
  return hosts.length > EU_PROCESSING_HOSTS_MAX
    ? { kind: 'tooMany', max: EU_PROCESSING_HOSTS_MAX }
    : undefined;
}
