/**
 * Peppered-hash helpers for fields that are propagated into long-lived
 * `auditLogs` rows.
 *
 * Round-2 v14 finding: login-attempt failures write `actorEmail` and
 * `ipAddress` as plaintext into the audit chain. The chain is retained
 * for 365–3650 days under audit retention, i.e. roughly 10× longer than
 * the new 30-day TTL on `loginAttempts` itself — the inverse of the
 * GDPR-data-minimization intent of the phase-11 reframe. A leaked DB
 * snapshot exposes raw email + IP for every failed sign-in over years.
 *
 * When `TALE_AUDIT_PEPPER` is set (>= 16 chars), new audit rows carry a
 * deterministic HMAC-SHA256 hash of the email and a CIDR-prefix of the IP
 * in the `*Hash` columns; without it the writers keep the plaintext
 * columns and this module warns once. `tale init` generates the pepper
 * with the other auto-secrets and an existing `.env` receives one on its
 * next `tale deploy` (headless auto-fill), so hashing is ON on every
 * CLI-managed deployment; the plaintext fallback only serves a hand-rolled
 * environment that has not picked the variable up yet.
 *
 * The hash is deterministic per (pepper, value), so an admin investigating
 * a brute-force pattern can reproduce the hash for a known suspect email
 * by computing `hmac(pepper, email.toLowerCase())` themselves. They do
 * NOT learn unrelated emails from the chain.
 *
 * Pepper rotation invalidates correlation across the rotation boundary.
 * That's the operator's intent — older rows age out under retention.
 *
 * Uses the standard Web Crypto APIs already used by `audit_hash.ts`.
 */

const PEPPER_ENV = 'TALE_AUDIT_PEPPER';

let warnedNoPepper = false;

function readPepper(): string | null {
  const raw = process.env[PEPPER_ENV];
  if (!raw || raw.length < 16) {
    if (!warnedNoPepper) {
      warnedNoPepper = true;
      const reason = !raw
        ? 'unset'
        : `too short (${raw.length} chars; need >= 16)`;
      console.warn(
        `[SECURITY] ${PEPPER_ENV} is ${reason} — login-attempt audit rows are written with plaintext email + IP. ` +
          `Set ${PEPPER_ENV} to a unique secret (>= 16 chars) before exposing the deployment to real users.`,
      );
    }
    return null;
  }
  return raw;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Split form for audit-log writers: returns either a plaintext value or
 * a hash, never both, depending on whether the pepper is configured.
 *
 * Hash shape: `sha256:<64-hex>` — the prefix keeps a hash distinguishable
 * from a legacy plaintext value for any walker that meets both.
 *
 * Lets callers populate `actorEmail` (plaintext column, searchable) when
 * no pepper is set, and `actorEmailHash` (separate column, opaque to UI)
 * when one is set. Avoids overwriting a plaintext column with a `sha256:`
 * marker which then breaks downstream search/export consumers (round-2
 * v14 H12).
 */
export async function splitEmailForAudit(
  email: string,
): Promise<{ plaintext?: string; hash?: string }> {
  const pepper = readPepper();
  if (pepper === null) return { plaintext: email };
  const h = await hmacSha256Hex(pepper, email.toLowerCase());
  return { hash: `sha256:${h}` };
}

/**
 * Split form for audit-log writers — see `splitEmailForAudit`. The IP is
 * reduced to a coarse prefix (`/24` for v4, `/64` for v6) before hashing:
 * coarsening preserves rate-limit forensics (CGNAT subnet, ISP geo) while
 * removing the per-host PII. An IP that doesn't parse is recorded as the
 * plaintext string — better than dropping the field entirely.
 */
export async function splitIpForAudit(
  ip: string,
): Promise<{ plaintext?: string; hash?: string }> {
  const pepper = readPepper();
  if (pepper === null) return { plaintext: ip };
  const prefix = coarsePrefix(ip);
  if (prefix === null) return { plaintext: ip };
  const h = await hmacSha256Hex(pepper, prefix);
  return { hash: `sha256:${h}` };
}

/**
 * Expand an IPv6 address to its canonical 8-group form, resolving `::`
 * shorthand. Returns `null` when the input doesn't parse.
 *
 * Round-2 v04 H3: the previous coarsePrefix used a naive `split(':')`
 * that produced wrong /64 prefixes whenever `::` compressed any of the
 * first four groups (`::1` → `::1::/64`, `2001:db8::1` → `2001:db8::1::/64`).
 * This helper expands first so the /64 truncation acts on real groups.
 */
export function expandIPv6(addr: string): string[] | null {
  const cleaned = addr
    .replace(/%.*$/, '') // strip zone id (`fe80::1%eth0`)
    .replace(/^\[|\]$/g, '') // strip bracketed form (`[2001:db8::1]`)
    .trim();
  if (cleaned === '') return null;
  if (!cleaned.includes(':')) return null;

  // RFC 4291: at most one `::` allowed.
  const firstDD = cleaned.indexOf('::');
  if (firstDD !== cleaned.lastIndexOf('::')) return null;

  let groups: string[];
  if (firstDD >= 0) {
    const headStr = cleaned.slice(0, firstDD);
    const tailStr = cleaned.slice(firstDD + 2);
    const head = headStr === '' ? [] : headStr.split(':');
    const tail = tailStr === '' ? [] : tailStr.split(':');
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = cleaned.split(':');
  }
  if (groups.length !== 8) return null;
  // Each group must be 1-4 hex chars (or empty already filtered out).
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
  }
  return groups;
}

function coarsePrefix(ip: string): string | null {
  // IPv4: keep the first 3 octets; v4-mapped v6 (`::ffff:1.2.3.4`) is
  // also handled here so audit reads consistent prefixes regardless of
  // how the proxy presented the address.
  const v4Match = ip.match(
    /(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/,
  );
  if (v4Match) {
    return `${v4Match[1]}.${v4Match[2]}.${v4Match[3]}.0/24`;
  }
  // IPv6: expand `::` shorthand to the canonical 8-group form, then
  // take the first 4 groups (/64 prefix).
  const groups = expandIPv6(ip);
  if (!groups) return null;
  const head = groups.slice(0, 4).join(':');
  return `${head}::/64`;
}
