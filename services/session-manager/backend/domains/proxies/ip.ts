// IP literals read and printed the strict way (RFC 4291, RFC 5952), so that a
// proxy host and an exit IP have one spelling. The identity key and the
// duplicate check depend on it, and the runtime's own parsers differ in the
// corners (`net.isIPv4('01.2.3.4')`, URL hosts like `127.1`).

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);
const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** Four decimal octets without leading zeros. */
export function isIPv4(text: string): boolean {
  return IPV4.test(text);
}

function ipv4Groups(text: string): [number, number] | null {
  if (!IPV4.test(text)) return null;
  const [a = 0, b = 0, c = 0, d = 0] = text.split('.').map(Number);
  return [(a << 8) | b, (c << 8) | d];
}

/**
 * The eight 16-bit groups of an IPv6 address, or `null`. A zone (`%eth0`) is
 * accepted and dropped. `::` stands for at least one group (`1:2:3:4:5:6:7::`
 * is valid, `1:2:3:4:5:6:7:8::` is not).
 */
function ipv6Groups(input: string): number[] | null {
  if (input.includes('/')) return null;
  const percent = input.indexOf('%');
  let text = input;
  if (percent >= 0) {
    const zone = input.slice(percent + 1);
    if (zone === '' || zone.includes('%')) return null;
    text = input.slice(0, percent);
  }
  const parts = text.split(':');
  if (parts.length < 3) return null;

  const last = parts[parts.length - 1] ?? '';
  if (last.includes('.')) {
    const tail = ipv4Groups(last);
    if (tail === null) return null;
    parts.pop();
    parts.push(tail[0].toString(16), tail[1].toString(16));
  }
  if (parts.length > 9) return null;

  let skip = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (parts[i] === '') {
      if (skip >= 0) return null;
      skip = i;
    }
  }

  let high: string[];
  let low: string[];
  if (skip >= 0) {
    let highCount = skip;
    let lowCount = parts.length - skip - 1;
    if (parts[0] === '' && --highCount > 0) return null;
    if (parts[parts.length - 1] === '' && --lowCount > 0) return null;
    if (8 - (highCount + lowCount) < 1) return null;
    high = parts.slice(0, highCount);
    low = parts.slice(parts.length - lowCount);
  } else {
    if (parts.length !== 8 || parts[0] === '' || parts[7] === '') return null;
    high = parts;
    low = [];
  }
  if (![...high, ...low].every((group) => HEXTET.test(group))) return null;
  const groups = [
    ...high,
    ...Array<string>(8 - high.length - low.length).fill('0'),
    ...low,
  ];
  return groups.map((group) => Number.parseInt(group, 16));
}

/** The longest run of two or more zero groups becomes `::` (the first one on a tie). */
function compress(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;
  groups.forEach((group, index) => {
    if (group !== 0) {
      start = -1;
      length = 0;
      return;
    }
    if (start < 0) start = index;
    length += 1;
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  });
  const hex = (slice: readonly number[]) =>
    slice.map((g) => g.toString(16)).join(':');
  if (bestLength < 2) return hex(groups);
  return `${hex(groups.slice(0, bestStart))}::${hex(groups.slice(bestStart + bestLength))}`;
}

/** The compressed lowercase form of an IPv6 address (zone dropped), or `null`. */
export function parseIPv6(text: string): string | null {
  const groups = ipv6Groups(text);
  return groups === null ? null : compress(groups);
}

/** The canonical spelling of an IPv4 or IPv6 address, or `null` if it is neither. */
export function normalizeIp(text: string): string | null {
  return isIPv4(text) ? text : parseIPv6(text);
}
