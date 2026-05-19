import { getProjectId } from '../../../utils/load-env';
import type { ComposeService, ServiceConfig } from '../types';
import { DEFAULT_LOGGING } from '../types';

/**
 * Sandbox egress proxy — tinyproxy sidecar on the internal `sandbox`
 * network. Filters CONNECT host requests against a configurable
 * allow-list (default: pypi.org, files.pythonhosted.org, registry.npmjs.org,
 * github package endpoints). Replaces the originally-planned iptables IP
 * allow-list which R1.3/R2.1 showed was unsafe due to shared Fastly /
 * Cloudflare CDN IPs.
 *
 * The runtime containers spawned by services/sandbox set
 * HTTPS_PROXY=http://sandbox-egress:3128 and join `tale-sandbox-net`
 * (internal: true), so this proxy is their ONLY outbound path.
 */
export function createSandboxEgressService(
  config: ServiceConfig,
): ComposeService {
  return {
    image: `${config.registry}/tale-sandbox-egress:${config.version}`,
    container_name: `${getProjectId()}-sandbox-egress`,
    env_file: ['.env'],
    restart: 'unless-stopped',
    healthcheck: {
      test: ['CMD', 'nc', '-z', '127.0.0.1', '3128'],
      interval: '10s',
      timeout: '3s',
      retries: 2,
      start_period: '5s',
    },
    logging: DEFAULT_LOGGING,
    // `sandbox` is internal-only; sandbox-egress also needs `internal` so it
    // can resolve and reach pypi/npm (those need DNS + NAT). Runtime
    // containers stay solely on `sandbox` and tunnel through this proxy.
    networks: ['sandbox', 'internal'],
  };
}
