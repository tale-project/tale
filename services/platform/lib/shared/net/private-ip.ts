/**
 * Private/loopback hostname recognition — the single implementation shared
 * by the request-time SSRF layers (`convex/lib/http/safe_fetch.ts`,
 * `convex/lib/http/host_policy.ts`) and the provider-definition schema
 * (`lib/shared/schemas/providers.ts`), which admits `http://` base URLs
 * only for hosts this predicate recognizes.
 *
 * Layer A: no imports — client code, V8 Convex code, `'use node'` actions,
 * and tests all share it.
 */

/**
 * Hostname-string match against private/loopback IP ranges. NOT an IP-pin:
 * a hostname controlled by an attacker can still rebind to private space
 * between this check and the actual `fetch` (which re-resolves DNS). For
 * tighter mitigation, use an undici Dispatcher with a `lookup` callback.
 *
 * Recognized:
 *  - `localhost`, `*.local`
 *  - IPv4: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, 224+
 *  - IPv6: ::1, fe80::/10, fc00::/7
 *  - IPv4-mapped IPv6: `::ffff:a.b.c.d` and the 32-bit hex form
 *    `::ffff:7f00:1` — decoded back to IPv4 before re-checking.
 */
export function isPrivateIp(hostname: string): boolean {
  // `URL.hostname` keeps surrounding brackets for IPv6 literals; strip them
  // so the prefix checks below match `[fc00::1]`, `[fd00:ec2::254]`, and
  // `[::ffff:7f00:1]` (mirrors checkProviderHostPolicy's normalization).
  // Also strip the IPv6 zone identifier (`fe80::1%eth0`) so it doesn't
  // change downstream matches.
  const lower = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.+$/, '');
  if (lower === 'localhost' || lower === 'localhost.') return true;
  if (lower.endsWith('.local')) return true;

  if (isPrivateIpv4(lower)) return true;

  // IPv4-mapped IPv6: `::ffff:a.b.c.d` form
  const mappedDotted = lower.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (mappedDotted) return isPrivateIpv4(mappedDotted[1]);

  // Normalize IPv6 to 8 hextets so prefix-based checks below match
  // shortened, expanded, and zero-padded forms uniformly. Anything not
  // parseable falls through and is treated as a non-IPv6 hostname.
  const hextets = expandIpv6(lower);
  if (hextets) {
    // ::1 loopback
    if (hextets.every((h, i) => (i === 7 ? h === 1 : h === 0))) return true;
    // :: unspecified (all zeros) — routes to "this host" on most stacks;
    // a hostile resolver returning it ends up dialing localhost.
    if (hextets.every((h) => h === 0)) return true;
    // Discard-only prefix 100::/64 (RFC 6666). Not a private range per se,
    // but no legitimate traffic should hit it from a Convex action.
    if (
      hextets[0] === 0x100 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0
    ) {
      return true;
    }
    // ULA fc00::/7 — first 7 bits = 1111110x, i.e. hextet[0] high byte
    // 0xfc or 0xfd.
    if ((hextets[0] & 0xff00) >= 0xfc00 && (hextets[0] & 0xff00) <= 0xfdff) {
      return true;
    }
    // Link-local fe80::/10 — first 10 bits = 1111111010xx, i.e. hextet[0]
    // in [0xfe80..0xfebf].
    if (hextets[0] >= 0xfe80 && hextets[0] <= 0xfebf) return true;
    // Site-local (deprecated) fec0::/10.
    if (hextets[0] >= 0xfec0 && hextets[0] <= 0xfeff) return true;
    // Multicast ff00::/8.
    if ((hextets[0] & 0xff00) === 0xff00) return true;
    // IPv4-mapped IPv6 ::ffff:0:0/96 — covers the standard `::ffff:H:L`
    // form AND its fully-expanded `0:0:0:0:0:ffff:H:L` representation.
    // Decode the embedded v4 and recurse.
    if (
      hextets[0] === 0 &&
      hextets[1] === 0 &&
      hextets[2] === 0 &&
      hextets[3] === 0 &&
      hextets[4] === 0 &&
      hextets[5] === 0xffff
    ) {
      const v4 = `${(hextets[6] >> 8) & 0xff}.${hextets[6] & 0xff}.${(hextets[7] >> 8) & 0xff}.${hextets[7] & 0xff}`;
      return isPrivateIpv4(v4);
    }
    // 6to4 2002::/16 — hextet[1..2] embeds the public v4 the tunnel
    // wraps; if that v4 is private, the tunnel targets a private host.
    if (hextets[0] === 0x2002) {
      const v4 = `${(hextets[1] >> 8) & 0xff}.${hextets[1] & 0xff}.${(hextets[2] >> 8) & 0xff}.${hextets[2] & 0xff}`;
      return isPrivateIpv4(v4);
    }
    // NAT64 64:ff9b::/96 (well-known prefix) and 64:ff9b:1::/48 (local
    // prefix). Last two hextets embed v4 directly.
    if (
      hextets[0] === 0x64 &&
      hextets[1] === 0xff9b &&
      ((hextets[2] === 0 &&
        hextets[3] === 0 &&
        hextets[4] === 0 &&
        hextets[5] === 0) ||
        hextets[2] === 1)
    ) {
      const v4 = `${(hextets[6] >> 8) & 0xff}.${hextets[6] & 0xff}.${(hextets[7] >> 8) & 0xff}.${hextets[7] & 0xff}`;
      return isPrivateIpv4(v4);
    }
  }

  return false;
}

/**
 * Expand `addr` to 8 16-bit hextets. Returns null when `addr` is not a
 * valid IPv6 literal (so the caller falls back to non-IPv6 handling).
 * Accepts the dotted-quad tail form (`::ffff:1.2.3.4`) and re-expresses it
 * as two hex hextets so the caller's recognizers can pattern-match on
 * fully-expanded forms uniformly.
 */
function expandIpv6(addr: string): number[] | null {
  if (!addr.includes(':')) return null;
  // Disallow inputs that look IP-ish but aren't valid hex literals.
  if (!/^[0-9a-f:.]+$/.test(addr)) return null;
  let working = addr;
  // Dotted-quad tail: ::ffff:1.2.3.4 → ::ffff:0102:0304
  const dotted = working.match(
    /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (dotted) {
    const a = Number(dotted[2]);
    const b = Number(dotted[3]);
    const c = Number(dotted[4]);
    const d = Number(dotted[5]);
    if ([a, b, c, d].some((n) => n > 255 || !Number.isFinite(n))) return null;
    const hi = ((a << 8) | b).toString(16);
    const lo = ((c << 8) | d).toString(16);
    working = `${dotted[1]}${hi}:${lo}`;
  }
  const parts = working.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail =
    parts[1] !== undefined ? (parts[1] ? parts[1].split(':') : []) : null;
  let hextets: string[];
  if (tail === null) {
    hextets = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    hextets = [...head, ...Array(missing).fill('0'), ...tail];
  }
  if (hextets.length !== 8) return null;
  const out: number[] = [];
  for (const h of hextets) {
    if (h.length === 0 || h.length > 4) return null;
    if (!/^[0-9a-f]+$/.test(h)) return null;
    out.push(Number.parseInt(h, 16));
  }
  return out;
}

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  // RFC 6598 CGNAT — used by Tailscale, cloud-internal load balancers,
  // and some metadata-style endpoints. Was missing in round-2 review.
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
