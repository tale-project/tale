import { createHash, randomBytes, X509Certificate } from 'node:crypto';

import { IncusApiError } from '@tale/incus/api';
import type { IncusClient } from '@tale/incus/client';
import { startInstance, stopInstance } from '@tale/incus/state';
import { incusSizeBytes } from '@tale/incus/units';
import { getStoragePoolResources } from '@tale/incus/volumes';

import { parseImageReference } from '../../../oci/registry';
import { parseCidr } from '../../../project/runtime-declaration';
import { addressPlan } from '../compile/address-plan';
import { execInInstance, type IncusVerbContext } from '../verbs/exec';
import { probeIncus } from '../verbs/probe';
import { formatBytes } from './contract';
import type { ContractRule, NodeContract } from './contract-model';

/**
 * `tale incus check` (design D-31, 14 step 6a): read back, with the stack's
 * restricted certificate, what the node holds, and refuse what differs from
 * the contract. It never claims what that certificate cannot see (R3-27):
 *
 * - the bridge's configuration, its ACLs and the host firewall are an
 *   administrator's; check judges them by their effect, a helper instance on
 *   the app bridge that opens the connections the contract's probed rules
 *   allow, and a connection that times out is refused with the remedies;
 * - Docker's published ports belong to `tale runtime migrate`;
 * - other projects' stop priorities belong to `tale incus bootstrap`.
 *
 * Every finding is one sentence from a fixed vocabulary (`CHECK_SENTENCES`),
 * so an operator and a test read the same words for the same defect.
 */

/** The sentences check speaks: one per kind of finding. */
export const CHECK_SENTENCES = {
  server: (detail: string) => `The Incus server: ${detail}.`,
  setting: (
    object: string,
    key: string,
    actual: string | undefined,
    expected: string,
  ) =>
    `${object} sets ${key} to ${actual === undefined || actual === '' ? '(unset)' : actual}; the contract needs ${expected}.`,
  limitLow: (object: string, key: string, actual: string, expected: string) =>
    `${object} limits ${key} to ${actual}, below the stack's peak of ${expected}.`,
  rootDisk: (profile: string, detail: string) =>
    `profile ${profile}'s root disk ${detail}.`,
  networkUnreadable: (network: string, project: string) =>
    `network ${network} cannot be read: it does not exist, or project ${project} may not use it (restricted.networks.access).`,
  networkAddress: (network: string, actual: string, expected: string) =>
    `network ${network} has the address ${actual}; the contract needs ${expected}.`,
  certificateMissing: () =>
    "the client certificate is not in the server's trust store.",
  certificateUnrestricted: (name: string) =>
    `the client certificate ${name} is not restricted; the contract needs it restricted to the stack project alone.`,
  certificateProjects: (name: string, actual: string[], expected: string[]) =>
    `the client certificate ${name} is restricted to ${actual.join(', ') || 'no project'}; the contract needs ${expected.join(', ')}.`,
  dropped: (rule: ContractRule, target: string) =>
    `${rule.purpose} A connection from the app bridge to ${target} timed out (ACL rule ${rule.id}).`,
  refused: (rule: ContractRule, target: string) =>
    `${rule.purpose} ${target} refused the connection from the app bridge: nothing listens there, or an ACL rejects it (ACL rule ${rule.id}).`,
  unresolved: (rule: ContractRule, target: string) =>
    `${rule.purpose} The bridge gateway did not answer the name ${target} (ACL rule ${rule.id}).`,
  probeNotRun: (detail: string) =>
    `The forwarding probes did not run: ${detail}.`,
  capacity: (pool: string, free: string, needed: string) =>
    `storage pool ${pool} has ${free} free; the stack's declared volumes and root disks need ${needed}.`,
} as const;

/** What to do when a probe from the app bridge times out (design R3-13):
 * the immediate remedy first, the one that needs a reboot second. */
export function forwardingRemedy(bridge: string): string {
  const rules = [bridge, '<sessions bridge>'].flatMap((name) => [
    `iptables -I DOCKER-USER -i ${name} -j ACCEPT`,
    `iptables -I DOCKER-USER -o ${name} -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT`,
  ]);
  return [
    "If Docker runs on this host, its FORWARD policy drops the bridges' traffic. Accept them in DOCKER-USER (works at once; tale incus bootstrap offers it):",
    ...rules.map((rule) => `  ${rule}`),
    'or set "ip-forward-no-drop": true in /etc/docker/daemon.json (takes effect only after a host reboot).',
    "Otherwise, add the contract's rule to the app bridge's ACL (tale incus contract).",
  ].join('\n');
}

export interface CheckFinding {
  level: 'refusal' | 'warning';
  sentence: string;
  remedy?: string;
}

export interface CheckReport {
  /** True when nothing was refused. */
  ok: boolean;
  findings: CheckFinding[];
  /** The probes that ran, and what each saw. */
  probes: { rule: string; target: string; outcome: ProbeOutcome }[];
}

/** What a connection from the helper saw. */
export type ProbeOutcome = 'open' | 'refused' | 'timeout' | 'unresolved';

export interface ProbeRequest {
  kind: 'tcp' | 'dns';
  /** An address (tcp) or the server asked (dns). */
  host: string;
  port: number;
  /** The name a dns probe asks for. */
  name?: string;
  /** Whether something must answer there: a refused connection then fails
   * (a bridge ACL's default reject answers the same way). Without it, a
   * refusal is the host's own answer, so the path is open. */
  listener?: boolean;
}

/** Runs probes from a helper on the app bridge; resolves once every probe
 * has an outcome. Throws when no helper could be made. */
export type ProbeRunner = (
  requests: readonly ProbeRequest[],
) => Promise<ProbeOutcome[]>;

export interface CheckOptions {
  /** The PEM of the certificate the client presents. */
  clientCertificate: string;
  /** Run the probes; null skips them (and says so as a refusal). */
  probes: ProbeRunner | null;
  /** The public address the egress probe connects to. */
  publicTarget: { host: string; port: number };
  /** The name the gateway DNS probe asks. */
  publicName: string;
}

function fingerprintOf(pem: string): string {
  return createHash('sha256')
    .update(new X509Certificate(pem).raw)
    .digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A rule's probe: what to connect to, from a helper on the app bridge. */
export function probeOf(
  rule: ContractRule,
  options: Pick<CheckOptions, 'publicTarget' | 'publicName'>,
): ProbeRequest | null {
  if (rule.check !== 'probe') return null;
  if (rule.id === 'public-egress')
    return { kind: 'tcp', ...options.publicTarget, listener: true };
  const destination = rule.destination?.[0];
  const port = rule.ports?.[0];
  if (destination === undefined || port === undefined) return null;
  const network = parseCidr(
    destination.includes('/') ? destination : `${destination}/32`,
  );
  // A single address is probed as itself; a network by its first host (the
  // sessions' bridge gateway answers for the sessions subnet).
  const target = network.prefix >= 31 ? network.first : network.first + 1;
  const host = [24, 16, 8, 0]
    .map((shift) => (target >>> shift) & 255)
    .join('.');
  if (rule.protocol === 'udp' && port === 53)
    return { kind: 'dns', host, port, name: options.publicName };
  if (rule.protocol !== 'tcp') return null;
  // No session needs to run for check: the sessions' gateway refusing 8200
  // is the host's answer, so the path is open.
  return {
    kind: 'tcp',
    host,
    port,
    listener: rule.id !== 'spawner-to-sessions',
  };
}

function compareProject(
  contract: NodeContract,
  actual: Record<string, string>,
  findings: CheckFinding[],
): void {
  const object = `project ${contract.project.name}`;
  for (const [key, expected] of Object.entries(contract.project.config)) {
    const value = actual[key];
    // probeIncus judges the registries, host by host (R3-12).
    if (key === 'restricted.images.servers') continue;
    if (key.startsWith('limits.') && key !== 'limits.virtual-machines') {
      // A limit above the peak is the operator's to give; below, a flip
      // would fail half way.
      if (value === undefined || value === '') continue;
      const have =
        key === 'limits.memory' || key.startsWith('limits.disk')
          ? incusSizeBytes(value)
          : Number(value);
      const need =
        key === 'limits.memory' || key.startsWith('limits.disk')
          ? incusSizeBytes(expected)
          : Number(expected);
      if (have !== undefined && need !== undefined && have < need)
        findings.push({
          level: 'refusal',
          sentence: CHECK_SENTENCES.limitLow(object, key, value, expected),
        });
      continue;
    }
    if (value !== expected)
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.setting(object, key, value, expected),
        remedy: `incus project set ${contract.project.name} ${key}=${expected}`,
      });
  }
}

async function compareProfile(
  client: IncusClient,
  contract: NodeContract,
  projectConfig: Record<string, string>,
  findings: CheckFinding[],
): Promise<void> {
  const name = contract.profile.name;
  let profile: Awaited<ReturnType<IncusClient['getProfile']>>;
  try {
    profile = await client.getProfile(name);
  } catch (error) {
    // probeIncus has named a missing profile already.
    if (error instanceof IncusApiError && error.status === 404) return;
    throw error;
  }
  const object = `profile ${name}`;
  for (const [key, expected] of Object.entries(contract.profile.config)) {
    // probeIncus names a limit the project sets and the profile lacks.
    const unset = (profile.config[key] ?? '') === '';
    if (unset && (projectConfig[key] ?? '') !== '') continue;
    if (profile.config[key] !== expected)
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.setting(
          object,
          key,
          profile.config[key],
          expected,
        ),
        remedy: `incus profile set ${name} ${key}=${expected} --project ${contract.project.name}`,
      });
  }
  const wanted = contract.profile.devices.root;
  const root = Object.values(profile.devices).find(
    (device) => device.type === 'disk' && device.path === '/',
  );
  if (wanted !== undefined && root !== undefined) {
    if (root.pool !== wanted.pool)
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.rootDisk(
          name,
          `is on pool ${root.pool ?? '(none)'}, not ${wanted.pool}`,
        ),
      });
    if (wanted.size !== undefined && root.size !== wanted.size)
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.rootDisk(
          name,
          `has the size ${root.size ?? '(unset)'}, not ${wanted.size}`,
        ),
      });
  }
}

async function compareNetwork(
  client: IncusClient,
  contract: NodeContract,
  findings: CheckFinding[],
): Promise<boolean> {
  const name = contract.network.name;
  let state: unknown;
  try {
    state = await client.sync(
      'GET',
      `/1.0/networks/${encodeURIComponent(name)}/state`,
      { query: { project: client.project }, retry: true },
    );
  } catch (error) {
    if (
      error instanceof IncusApiError &&
      (error.status === 404 || error.status === 403)
    ) {
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.networkUnreadable(
          name,
          contract.project.name,
        ),
      });
      return false;
    }
    throw error;
  }
  const expected = `${contract.network.gateway}/${parseCidr(contract.network.subnet).prefix}`;
  const addresses = (
    isRecord(state) && Array.isArray(state.addresses) ? state.addresses : []
  )
    .filter(isRecord)
    .filter((entry) => entry.family === 'inet')
    .map((entry) => `${String(entry.address)}/${String(entry.netmask)}`);
  if (!addresses.includes(expected))
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.networkAddress(
        name,
        addresses.join(', ') || '(none)',
        expected,
      ),
    });
  return true;
}

async function compareCertificate(
  client: IncusClient,
  contract: NodeContract,
  pem: string,
  findings: CheckFinding[],
): Promise<void> {
  const fingerprint = fingerprintOf(pem);
  let entry: unknown;
  try {
    entry = await client.sync('GET', `/1.0/certificates/${fingerprint}`, {
      retry: true,
    });
  } catch (error) {
    if (error instanceof IncusApiError && error.status === 404) {
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.certificateMissing(),
      });
      return;
    }
    throw error;
  }
  if (!isRecord(entry)) return;
  const name =
    typeof entry.name === 'string' ? entry.name : fingerprint.slice(0, 12);
  if (entry.restricted !== true) {
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.certificateUnrestricted(name),
    });
    return;
  }
  const projects = Array.isArray(entry.projects)
    ? entry.projects
        .filter((item): item is string => typeof item === 'string')
        .sort()
    : [];
  const expected = [...contract.certificate.projects].sort();
  if (projects.join(',') !== expected.join(','))
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.certificateProjects(name, projects, expected),
    });
}

async function checkCapacity(
  client: IncusClient,
  contract: NodeContract,
  findings: CheckFinding[],
): Promise<void> {
  const existing = new Set(
    (
      (await client
        .sync(
          'GET',
          `/1.0/storage-pools/${encodeURIComponent(contract.storage.pool)}/volumes/custom`,
          { query: { project: client.project }, retry: true },
        )
        .catch((error: unknown) => {
          console.warn(
            'The stack volumes could not be listed for the capacity check:',
            error instanceof Error ? error.message : error,
          );
          return [];
        })) as unknown[]
    ).map((entry) =>
      // A path without recursion; an object with it.
      isRecord(entry) && typeof entry.name === 'string'
        ? entry.name
        : (String(entry).split('/').pop() ?? ''),
    ),
  );
  const rootBytes = incusSizeBytes(contract.storage.rootSize) ?? 0;
  let needed = rootBytes * contract.peak.instances;
  for (const volume of contract.storage.volumes)
    if (volume.size !== undefined && !existing.has(volume.name))
      needed += incusSizeBytes(volume.size) ?? 0;
  const resources = await getStoragePoolResources(
    client,
    contract.storage.pool,
  );
  const free = resources.space.total - resources.space.used;
  if (free < needed)
    findings.push({
      level: 'warning',
      sentence: CHECK_SENTENCES.capacity(
        contract.storage.pool,
        formatBytes(free),
        formatBytes(needed),
      ),
    });
}

/** Read the node back and judge it against `contract`. */
export async function checkNode(
  client: IncusClient,
  contract: NodeContract,
  options: CheckOptions,
): Promise<CheckReport> {
  const findings: CheckFinding[] = [];
  const probed: CheckReport['probes'] = [];

  if ((await client.getServer()).auth !== 'trusted') {
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.certificateMissing(),
      remedy: `incus config trust add-certificate <client.crt> --restricted --projects ${contract.project.name}`,
    });
    return { ok: false, findings, probes: probed };
  }
  // The server, the project's features and registries, the profile and the
  // pool, as the runtime's own probe judges them before every deploy.
  const probe = await probeIncus(client, {
    pool: contract.storage.pool,
    registries: contract.registries,
  });
  for (const error of probe.errors)
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.server(error),
    });
  for (const warning of probe.warnings)
    findings.push({
      level: 'warning',
      sentence: CHECK_SENTENCES.server(warning),
    });

  await compareCertificate(
    client,
    contract,
    options.clientCertificate,
    findings,
  );
  const projectConfig = (await client.getProject()).config;
  compareProject(contract, projectConfig, findings);
  await compareProfile(client, contract, projectConfig, findings);
  const networkReadable = await compareNetwork(client, contract, findings);
  await checkCapacity(client, contract, findings);

  // The forwarding probes (design R3-27): their effect is all a restricted
  // certificate can judge of the bridge's ACL and the host firewall.
  const rules = contract.acls.rules
    .map((rule) => ({ rule, request: probeOf(rule, options) }))
    .filter(
      (item): item is { rule: ContractRule; request: ProbeRequest } =>
        item.request !== null,
    );
  if (options.probes === null)
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.probeNotRun(
        'they were turned off, so forwarding from the app bridge is not judged',
      ),
    });
  else if (!networkReadable)
    findings.push({
      level: 'refusal',
      sentence: CHECK_SENTENCES.probeNotRun('the app bridge cannot be read'),
    });
  else {
    let outcomes: ProbeOutcome[];
    try {
      outcomes = await options.probes(rules.map((item) => item.request));
    } catch (error) {
      findings.push({
        level: 'refusal',
        sentence: CHECK_SENTENCES.probeNotRun(
          error instanceof Error ? error.message : String(error),
        ),
      });
      outcomes = [];
    }
    const remedy = forwardingRemedy(contract.network.name);
    for (const [index, outcome] of outcomes.entries()) {
      const item = rules[index];
      if (item === undefined) continue;
      const target =
        item.request.kind === 'dns'
          ? (item.request.name ?? '')
          : `${item.request.host}:${item.request.port}`;
      probed.push({ rule: item.rule.id, target, outcome });
      if (outcome === 'timeout')
        findings.push({
          level: 'refusal',
          sentence: CHECK_SENTENCES.dropped(item.rule, target),
          remedy,
        });
      else if (
        outcome === 'unresolved' ||
        (item.request.kind === 'dns' && outcome !== 'open')
      )
        findings.push({
          level: 'refusal',
          sentence: CHECK_SENTENCES.unresolved(item.rule, target),
          remedy,
        });
      else if (outcome === 'refused' && item.request.listener === true)
        findings.push({
          level: 'refusal',
          sentence: CHECK_SENTENCES.refused(item.rule, target),
          remedy:
            item.rule.id === 'spawner-to-incus'
              ? "Make Incus listen there (incus config set core.https_address <address>:8443), and give the app bridge the contract's rule."
              : "Give the app bridge the contract's rule (tale incus contract); with a default reject, a missing rule answers like a closed port.",
        });
    }
  }
  return {
    ok: !findings.some((finding) => finding.level === 'refusal'),
    findings,
    probes: probed,
  };
}

// ---- the helper that probes ----------------------------------------------------

/** A tale-proxy alias of the project (`tale-proxy-<32 hex>`), which a deploy
 * pulled already. */
const PROXY_ALIAS = /^tale-proxy-[0-9a-f]{32}$/;
const PROBE_WAIT_MS = 120_000;
const PROBE_TIMEOUT_S = 5;

/** How a helper's probe output reads (busybox `nc -z -v`, `nslookup`). */
export function classifyProbe(
  request: ProbeRequest,
  result: { exitCode: number; stdout: string; stderr: string },
): ProbeOutcome {
  if (result.exitCode === 0) return 'open';
  const output = `${result.stdout}\n${result.stderr}`;
  if (request.kind === 'dns') return 'unresolved';
  if (/timed out/i.test(output)) return 'timeout';
  if (/bad address|can't resolve/i.test(output)) return 'unresolved';
  return 'refused';
}

/** The command a helper runs for one probe. */
export function probeCommand(request: ProbeRequest): string[] {
  return request.kind === 'dns'
    ? ['nslookup', '-type=a', request.name ?? '', request.host]
    : [
        'nc',
        '-z',
        '-v',
        '-w',
        String(PROBE_TIMEOUT_S),
        request.host,
        String(request.port),
      ];
}

/**
 * A probe runner over a helper instance (design D-30) on the app bridge, at
 * the first helper address no instance holds, made from a `tale-proxy` image
 * the project holds; without one, from `probeImage`, pulled for the probe
 * and deleted after. The helper is deleted whatever happens.
 */
export function helperProbes(
  context: IncusVerbContext,
  contract: NodeContract,
  probeImage: string,
): ProbeRunner {
  return async (requests) => {
    const client = context.client;
    const aliases = await client.listImageAliases();
    let alias = aliases.find((entry) => PROXY_ALIAS.test(entry.name))?.name;
    let pulled: string | undefined;
    if (alias === undefined) {
      const reference = parseImageReference(probeImage);
      pulled = `tale-check-probe-${randomBytes(4).toString('hex')}`;
      await client.pullOciImage(
        {
          server: `https://${reference.registry}`,
          alias:
            reference.digest === null
              ? `${reference.repository}:${reference.tag ?? 'latest'}`
              : `${reference.repository}@${reference.digest}`,
        },
        pulled,
        PROBE_WAIT_MS * 5,
      );
      alias = pulled;
    }
    const plan = addressPlan(
      {
        subnet: contract.network.subnet,
        gateway: contract.network.gateway,
        block: contract.network.block,
      },
      contract.path,
      { platform: 1, 'backend-api': 1, 'backend-worker': 1 },
    );
    const taken = new Set(
      (await client.listInstances()).flatMap((instance) =>
        Object.values(instance.devices ?? {}).map(
          (device) => (device['ipv4.address'] ?? '').split('/')[0],
        ),
      ),
    );
    const address = plan.helpers().find((candidate) => !taken.has(candidate));
    if (address === undefined)
      throw new Error('every helper address of the block is taken');
    const name = `job-check-${randomBytes(4).toString('hex')}`;
    try {
      await client.createInstance(
        {
          name,
          ephemeral: false,
          profiles: [contract.profile.name],
          config: {
            'security.idmap.isolated': 'true',
            'oci.entrypoint': 'sleep 600',
            'oci.dns.nameservers': contract.network.gateway,
            'user.tale.stack': context.stack,
            'user.tale.role': 'helper',
            'user.tale.purpose': 'check',
          },
          devices: {
            eth0: {
              type: 'nic',
              network: contract.network.name,
              name: 'eth0',
              'ipv4.address': `${address}/${plan.subnetPrefix}`,
              'ipv4.gateway': plan.gateway,
              'ipv6.address': 'none',
            },
          },
          source: { type: 'image', alias },
          start: false,
        },
        PROBE_WAIT_MS,
      );
      await startInstance(client, name);
      return await Promise.all(
        requests.map(async (request) =>
          classifyProbe(
            request,
            await execInInstance(context, name, probeCommand(request), {
              timeoutS: PROBE_TIMEOUT_S * 3,
            }),
          ),
        ),
      );
    } finally {
      try {
        if ((await client.getInstance(name)) !== undefined) {
          await stopInstance(client, name, {
            timeoutSeconds: 0,
            force: true,
          }).catch((error: unknown) => {
            console.warn(
              `The probe helper ${name} did not stop:`,
              error instanceof Error ? error.message : error,
            );
          });
          await client.deleteInstance(name, PROBE_WAIT_MS);
        }
      } catch (error) {
        console.warn(
          `The probe helper ${name} could not be deleted; the next one-shot job reaps it:`,
          error instanceof Error ? error.message : error,
        );
      }
      if (pulled !== undefined)
        try {
          const target = (await client.getImageAlias(pulled))?.target;
          if (target !== undefined)
            await client.deleteImage(target, PROBE_WAIT_MS);
        } catch (error) {
          console.warn(
            `The probe image ${pulled} could not be deleted:`,
            error instanceof Error ? error.message : error,
          );
        }
    }
  };
}
