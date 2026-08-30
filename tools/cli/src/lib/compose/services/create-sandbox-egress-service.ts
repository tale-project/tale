import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

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
    image: `${config.registry}/tale-sandbox-egress:${config.version}`,
    container_name: `${getProjectId()}-sandbox-egress`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    // Least privilege: drop the full default cap set, add back only what the
    // container provably needs (verified live against the image). NET_ADMIN
    // installs the iptables SSRF firewall; DAC_OVERRIDE lets root touch/create
    // the tinyproxy log in the nobody-owned /var/log/tinyproxy; CHOWN chowns it
    // to nobody; SETUID/SETGID let tinyproxy drop privileges to nobody after
    // bind; NET_BIND_SERVICE lets dnsmasq bind privileged port 53 to serve
    // external DNS to the internal-only sandbox network (dnsmasq requires the
    // cap explicitly, even as root). Keep in sync with sandbox-egress in compose.yml.
    cap_drop: ['ALL'],
    cap_add: [
      'NET_ADMIN',
      'DAC_OVERRIDE',
      'CHOWN',
      'SETUID',
      'SETGID',
      'NET_BIND_SERVICE',
    ],
    // tinyproxy + tail = trivial footprint; the cap is here to bound a
    // misbehaving allowlist-regex DoS that pegs CPU or floods the log.
    mem_limit: '512m',
    pids_limit: 512,
    ulimits: {
      nofile: { soft: 4096, hard: 8192 },
    },
    healthcheck: {
      // Local readiness probe: a TCP `nc -z 3128` confirms tinyproxy is
      // bound and accepting connections. We deliberately do NOT probe an
      // external host (pypi) on every interval: 10s × 24h = 8,640
      // pypi.org/simple/ hits per day per host, which is wasteful and
      // makes the proxy's healthiness depend on a third party's uptime
      // (a pypi blip would flap the container and trigger restarts).
      // Allow-list regressions are caught by the smoke test, not by the
      // health probe.
      test: ['CMD-SHELL', 'nc -z 127.0.0.1 3128 || exit 1'],
      interval: '30s',
      timeout: '3s',
      retries: 3,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['sandbox', 'internal'],
  };
}
