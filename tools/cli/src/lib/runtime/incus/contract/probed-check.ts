import { IncusClient } from '@tale/incus/client';

import { readIncusCredentials } from '../credentials';
import { checkNode, helperProbes, type CheckReport } from './check';
import { contractOf, type ContractSource } from './contract';

/** The public address and name the probes aim at by default. */
export const DEFAULT_PROBE_PUBLIC = { host: '1.1.1.1', port: 443 } as const;
export const DEFAULT_PROBE_NAME = 'tale.dev';

/** The image a probe helper runs by default: the release's `tale-proxy`. */
export function defaultProbeImage(version: string): string {
  return `ghcr.io/tale-project/tale/tale-proxy:${version}`;
}

/** What the forwarding probes of a check aim at (`tale incus check`). */
export interface ProbeTargets {
  /** The image a probe helper runs when the project holds no `tale-proxy`. */
  image: string;
  /** The public address the egress probe connects to. */
  publicTarget: { host: string; port: number };
  /** The public name the gateway DNS probe asks for. */
  publicName: string;
  /** Run the forwarding probes; without them check refuses. */
  probes: boolean;
}

/**
 * `tale incus check` of one contract source: the node read back with the
 * stack's restricted certificate from `directory`, and, unless turned off,
 * the forwarding probes from a helper on the app bridge (R3-27). The command
 * and `tale runtime migrate` (design 14 step 6a) run the same check.
 */
export async function probedCheck(
  source: ContractSource,
  directory: string,
  targets: ProbeTargets,
): Promise<CheckReport> {
  const contract = contractOf(source);
  const tls = await readIncusCredentials(directory);
  const client = new IncusClient({
    endpoint:
      source.declaration.endpoint ??
      `https://${source.declaration.network.gateway}:8443`,
    project: source.declaration.project,
    tls,
    signal: () => undefined,
  });
  return checkNode(client, contract, {
    clientCertificate: tls.cert,
    probes: targets.probes
      ? helperProbes(
          { client, stack: contract.stack, stateRoot: directory },
          contract,
          targets.image,
          source.declaration,
        )
      : null,
    publicTarget: targets.publicTarget,
    publicName: targets.publicName,
  });
}
