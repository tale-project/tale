import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING, imageRef } from '../types';

/**
 * The egress readiness probe, shared by both compose pipelines and kept
 * byte-identical to the `HEALTHCHECK` baked into
 * `services/sandbox-egress/Dockerfile` (guarded in `compose-parity.test.ts`).
 * See the `healthcheck` block below for why it is an HTTP request and not a
 * TCP connect.
 */
export const EGRESS_HEALTH_PROBE =
  "curl -sS -o /dev/null --max-time 3 --noproxy '*' http://127.0.0.1:3128/ || exit 1";

/**
 * Sandbox egress proxy — tinyproxy on `sandbox` (faces the runtime
 * containers) + `internal` (the only Docker network in this stack with
 * outbound NAT; `tale-sandbox-net` is created with `--internal` so
 * runtime containers cannot bypass the proxy).
 *
 * Open egress by default: CONNECT :443 to any public host. Setting
 * SANDBOX_EGRESS_ALLOWLIST switches the proxy to a default-deny
 * hostname allow-list (pipe-separated regexes; restart to apply).
 *
 * NET_ADMIN is granted so the container's entrypoint installs iptables
 * REJECT rules for IMDS (169.254.169.254) and RFC1918 ranges. In the
 * default open mode these rules are the only hostname-independent
 * egress fence; with an allowlist they additionally cover DNS-rebind
 * flipping an allowlisted hostname to a private IP between tinyproxy's
 * lookup and the kernel connect(). Mirrors
 * services/platform/docker-entrypoint.sh.
 *
 * Egress IS reachable from `internal` peers (platform, backend, web) —
 * but the IMDS/RFC1918 rules still apply and the proxy only
 * reaches the same internet those peers can reach directly via their
 * own NAT. The proxy is not a meaningful new attack surface for those
 * peers; the isolation it provides is for the `--internal` sandbox
 * network, where it is the only outbound path.
 */
export function createSandboxEgressService(
  config: ServiceConfig,
): ComposeService {
  // Single egress sidecar (blue-green dropped): spawned runtime containers
  // reach it via the bare `sandbox-egress` service-key alias on the shared
  // sandbox network. The container-local iptables SSRF fence (IMDS/RFC1918)
  // runs inside it.
  return {
    image: imageRef(config, 'sandbox-egress'),
    container_name: `${getProjectId()}-sandbox-egress`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Match compose.yml: IPv4-only networks need no IPv6 kernel firewall.
    // Explicit defaults also cover org build bridges attached after startup.
    sysctls: {
      'net.ipv6.conf.all.disable_ipv6': '1',
      'net.ipv6.conf.default.disable_ipv6': '1',
    },
    // Least privilege: drop the full default cap set, add back only what the
    // container provably needs (verified live against the image). NET_ADMIN
    // installs the iptables SSRF firewall; DAC_OVERRIDE lets root touch/create
    // the tinyproxy log in the nobody-owned /var/log/tinyproxy; CHOWN chowns it
    // to nobody; SETUID/SETGID let tinyproxy drop privileges to nobody after
    // bind; NET_BIND_SERVICE lets dnsmasq bind privileged port 53 to serve
    // external DNS to the internal-only sandbox network (dnsmasq requires the
    // cap explicitly, even as root). KILL lets the root supervisor signal its
    // nobody child for graceful shutdown. Keep in sync with compose.yml.
    cap_drop: ['ALL'],
    cap_add: [
      'NET_ADMIN',
      'DAC_OVERRIDE',
      'CHOWN',
      'SETUID',
      'SETGID',
      'NET_BIND_SERVICE',
      'KILL',
    ],
    // tinyproxy + tail = trivial footprint; the cap is here to bound a
    // misbehaving allowlist-regex DoS that pegs CPU or floods the log.
    mem_limit: '512m',
    pids_limit: 512,
    ulimits: {
      nofile: { soft: 4096, hard: 8192 },
    },
    healthcheck: {
      // Local readiness probe: one HTTP request to the proxy port. A
      // non-proxy request is answered by tinyproxy itself with its own 400
      // page, so the round trip never leaves the container and still proves
      // the daemon reads and serves — where a bare `nc -z` only proved the
      // kernel accepted the socket and called a proxy that accepts but never
      // answers healthy. The 400 IS the healthy answer, so no `-f`; curl
      // still exits non-zero on refusal, timeout or empty reply.
      // `--noproxy '*'` keeps an http_proxy in the container's `.env` from
      // redirecting the probe away from the proxy it is probing.
      //
      // NOT `nc -z`: tinyproxy logs every connect-and-close at ERROR
      // ("read_request_line: Client … closed socket before read."), so a TCP
      // probe wrote one error line per interval, for the lifetime of the
      // container, into the log an operator reads to find real failures.
      //
      // We still deliberately do NOT probe an external host (pypi) on every
      // interval: 30s × 24h = 2,880 pypi.org/simple/ hits per day per host,
      // which is wasteful and makes the proxy's healthiness depend on a third
      // party's uptime (a pypi blip would flap the container and trigger
      // restarts). Allow-list regressions are caught by the smoke test, not
      // by the health probe.
      test: ['CMD-SHELL', EGRESS_HEALTH_PROBE],
      interval: '30s',
      // Above curl's own `--max-time 3`, so a slow proxy is reported by curl
      // (exit 28, with a reason in the health log) instead of being cut off
      // by Docker at the same moment.
      timeout: '5s',
      retries: 3,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['sandbox', 'internal'],
  };
}
