/**
 * IP-address detection — wide-net regex + validator.
 *
 * Detection strategy
 *   - Regex matches both IPv4 dotted form (`A.B.C.D`) and IPv6
 *     colon-separated candidates (including compressed `::` form).
 *     `validator/lib/isIP` post-filter handles the actual range and
 *     compression checks.
 *
 * Locale awareness
 *   - None. IP-address syntax is locale-independent.
 */

import isIP from 'validator/lib/isIP';

import type { PiiPattern, PiiPatternFactory } from '../core/types';

// NOTE: Private/reserved IPv4 ranges (10.x, 172.16-31.x, 192.168.x) are
// intentionally detected and masked. Private IPs are PII when they reveal
// internal network topology, host identity, or user device information.
//
// IPv4 dotted-quad OR IPv6: 2-7 leading "hex:" runs (hex may be empty to
// encode the `::` zero-compression form), then either a final dotted-quad
// IPv4 tail (`::ffff:192.0.2.1`) or one final hex group, then an optional
// `%zone` identifier (`fe80::1%eth0`, `fe80::1%25en0` percent-encoded).
// Putting the IPv4 alternative first in the tail alternation prevents
// the regex from greedily consuming just `192` as a hex group when an
// embedded IPv4 is present. `validator/lib/isIP` does not understand
// zone IDs, so the post-filter strips the `%…` tail before validating —
// the zone is opaque metadata and a valid IPv6 with a zone is still PII.
// Bounded zone length keeps pathological inputs out of the validator.
const IP_ADDRESS_REGEX =
  /\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-fA-F]{0,4}:){2,7}(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F]{1,4})(?:%[A-Za-z0-9_.~-]{1,32})?/g;

const PATTERN: PiiPattern = {
  name: 'ipAddress',
  regex: IP_ADDRESS_REGEX,
  validate: (m) => {
    try {
      const stripped = m.includes('%') ? m.slice(0, m.indexOf('%')) : m;
      return isIP(stripped);
    } catch (err) {
      console.warn(
        `[pii] IP address validation error: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      return false;
    }
  },
  replacement: '[IP_ADDRESS]',
};

export const ipAddressFactory: PiiPatternFactory = () => [PATTERN];
