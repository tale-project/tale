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

const PATTERN: PiiPattern = {
  name: 'ipAddress',
  regex:
    /\b(?:\d{1,3}\.){3}\d{1,3}\b|(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}/g,
  validate: (m) => {
    try {
      return isIP(m);
    } catch {
      return false;
    }
  },
  replacement: '[IP_ADDRESS]',
};

export const ipAddressFactory: PiiPatternFactory = () => [PATTERN];
