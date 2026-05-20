import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * Sandbox egress proxy — tinyproxy on `sandbox` (faces the runtime
 * containers) + `internal` (the only Docker network in this stack with
 * outbound NAT to pypi/npmjs/etc; `tale-sandbox-net` is created with
 * `--internal` so runtime containers cannot bypass the proxy).
 *
 * Filters CONNECT host requests against a configurable allow-list
 * (default: pypi.org, files.pythonhosted.org, registry.npmjs.org,
 * github package endpoints). Replaces the originally-planned iptables IP
 * allow-list which R1.3/R2.1 showed was unsafe due to shared Fastly /
 * Cloudflare CDN IPs.
 *
 * NET_ADMIN is granted so the container's entrypoint installs iptables
 * REJECT rules for IMDS (169.254.169.254) and RFC1918 ranges; this is
 * defense-in-depth against a DNS-rebind attack flipping an allowlisted
 * hostname to a private IP between tinyproxy's lookup and the kernel
 * connect(). Mirrors services/convex/docker-entrypoint.sh.
 *
 * Egress IS reachable from `internal` peers (rag, crawler, platform,
 * web) — but only as a hostname-filtered proxy that can already reach
 * the same registries those peers can reach directly via their own NAT.
 * The proxy is not a meaningful new attack surface for those peers; the
 * isolation it provides is for the `--internal` sandbox network, where
 * it is the only outbound path.
 */
export function createSandboxEgressService(
  config: ServiceConfig,
): ComposeService {
  return {
    image: `${config.registry}/tale-sandbox-egress:${config.version}`,
    container_name: `${getProjectId()}-sandbox-egress`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    cap_add: ['NET_ADMIN'],
    healthcheck: {
      // CONNECT-probe an allowlisted host: a pure TCP `nc -z 3128` would
      // stay green even if the allowlist was wiped or upstream broke.
      // Healthy iff the proxy still tunnels to a known-good registry.
      test: [
        'CMD-SHELL',
        'curl -sf -x http://127.0.0.1:3128 -o /dev/null --connect-timeout 3 https://pypi.org/simple/ || exit 1',
      ],
      interval: '10s',
      timeout: '5s',
      retries: 2,
      start_period: '10s',
    },
    logging: DEFAULT_LOGGING,
    networks: ['sandbox', 'internal'],
  };
}
