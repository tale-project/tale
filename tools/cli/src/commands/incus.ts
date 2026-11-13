import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { IncusClient } from '@tale/incus/client';
import { createUnixSocketClient } from '@tale/incus/unix-transport';
import { Command } from 'commander';

import pkg from '../../package.json';
import { resolveConfigurationSource } from '../lib/deployment/configuration-source';
import { parseDeclarationText } from '../lib/deployment/declaration-text';
import { resolveDeploymentSpec } from '../lib/deployment/model';
import {
  applyFirewall,
  defaultSessionsZone,
  planBootstrap,
  planRemoval,
  removeFirewall,
  type BootstrapPlan,
  type HostCommand,
} from '../lib/runtime/incus/contract/bootstrap';
import {
  checkNode,
  helperProbes,
  type CheckReport,
} from '../lib/runtime/incus/contract/check';
import {
  contractOf,
  managedContractSource,
  workspaceContractSource,
  type ContractSource,
} from '../lib/runtime/incus/contract/contract';
import {
  managedIncusDirectory,
  readIncusCredentials,
  workspaceIncusDirectory,
} from '../lib/runtime/incus/credentials';
import { ExitCode, preconditionError, usageError } from '../utils/fail';
import { emitJson } from '../utils/json-output';
import * as logger from '../utils/logger';
import { getOutputMode } from '../utils/output-mode';
import { confirm, isInteractive } from '../utils/prompt';
import { action } from '../utils/run-command';

/**
 * `tale incus`: the node an Incus stack runs on (design D-31).
 *
 * - `contract` prints what the node must hold, as versioned JSON;
 * - `check` reads it back with the stack's restricted certificate;
 * - `bootstrap` makes it on a single box over the local admin socket.
 */

interface SourceOptions {
  workspace?: string;
  spec?: string;
  compose?: string;
}

async function contractSource(options: SourceOptions): Promise<ContractSource> {
  if (options.spec !== undefined) {
    if (options.compose === undefined)
      throw usageError(
        "--spec needs --compose: the runtime compose.yml of the deployment (the bundle's runtime/compose.yml).",
      );
    return managedContractSource(options.spec, options.compose);
  }
  if (options.compose !== undefined)
    throw usageError('--compose is read only with --spec.');
  return workspaceContractSource(
    resolve(options.workspace ?? '.'),
    pkg.version,
  );
}

/** The managed deployment's state directory, where its credentials live. */
async function stateDirectoryOf(specPath: string): Promise<string> {
  const spec = resolveDeploymentSpec(
    await resolveConfigurationSource(
      parseDeclarationText(readFileSync(specPath, 'utf8'), specPath),
      specPath,
    ),
  );
  return spec.stateDirectory;
}

const hostCommand: HostCommand = async (argv) => {
  const child = Bun.spawn([...argv], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

function parsePublicTarget(text: string): { host: string; port: number } {
  const match = /^((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/.exec(text);
  const port = Number(match?.[2]);
  if (match === null || port < 1 || port > 65535)
    throw usageError(
      `--probe-public must be an IPv4 address and a port, such as 1.1.1.1:443, not ${JSON.stringify(text)}.`,
    );
  return { host: match[1] ?? '', port };
}

function printReport(report: CheckReport): void {
  logger.header('Checking the Incus node against the contract');
  for (const probe of report.probes)
    (probe.outcome === 'timeout' || probe.outcome === 'unresolved'
      ? logger.error
      : logger.success)(
      `probe ${probe.rule}: ${probe.target} ${probe.outcome}`,
    );
  for (const finding of report.findings) {
    (finding.level === 'refusal' ? logger.error : logger.warn)(
      finding.sentence,
    );
    if (finding.remedy !== undefined)
      for (const line of finding.remedy.split('\n')) logger.info(`  ${line}`);
  }
  if (report.ok) logger.success('The node holds what the contract needs.');
  else logger.error('Fix the refusals above, then run tale incus check again.');
}

function printPlan(plan: BootstrapPlan, title: string): void {
  logger.header(title);
  for (const step of plan.steps)
    (step.action === 'refuse' ? logger.error : logger.info)(
      `${step.action.padEnd(6)} ${step.object}${step.detail === '' ? '' : `: ${step.detail}`}`,
    );
  for (const rule of plan.firewall)
    logger.info(`firewall iptables ${rule.join(' ')}`);
  for (const warning of plan.warnings) logger.warn(warning);
  for (const refusal of plan.refusals) logger.error(refusal);
}

/** Ask before touching the host firewall; never assumed, never silent. */
async function firewallConsent(
  rules: readonly string[][],
  verb: string,
): Promise<boolean> {
  if (rules.length === 0) return false;
  if (!isInteractive()) {
    logger.warn(
      `Not ${verb} the DOCKER-USER rules above without a terminal to ask on; run them by hand, or run bootstrap in a terminal.`,
    );
    return false;
  }
  return confirm({
    message: `${verb[0]?.toUpperCase()}${verb.slice(1)} the ${rules.length} DOCKER-USER rules above?`,
    default: false,
    assumeYes: false,
  });
}

export function createIncusCommand(): Command {
  const command = new Command('incus').description(
    'Describe, check and bootstrap the Incus node a stack runs on (experimental)',
  );

  command
    .command('contract')
    .description('Print what the Incus node must hold for the stack, as JSON')
    .option(
      '--workspace <dir>',
      'Workspace whose tale.json declares the Incus runtime',
      '.',
    )
    .option('--spec <file>', 'Managed deployment specification')
    .option('--compose <file>', "The runtime's compose.yml, with --spec")
    .action(
      action(async (options: SourceOptions) => {
        const contract = contractOf(await contractSource(options));
        process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
      }),
    );

  command
    .command('check')
    .description(
      "Read the Incus node back with the stack's restricted certificate and refuse what differs from the contract",
    )
    .option(
      '--workspace <dir>',
      'Workspace whose tale.json declares the Incus runtime',
      '.',
    )
    .option('--spec <file>', 'Managed deployment specification')
    .option('--compose <file>', "The runtime's compose.yml, with --spec")
    .option(
      '--probe-image <reference>',
      'The image a probe helper runs when the project holds no tale-proxy image yet',
      `ghcr.io/tale-project/tale/tale-proxy:${pkg.version}`,
    )
    .option(
      '--probe-public <address:port>',
      'The public address the egress probe connects to',
      '1.1.1.1:443',
    )
    .option(
      '--probe-name <name>',
      'The public name the gateway DNS probe asks for',
      'tale.dev',
    )
    .option(
      '--no-probes',
      'Do not run the forwarding probes (check then refuses)',
    )
    .action(
      action(
        async (
          options: SourceOptions & {
            probeImage: string;
            probePublic: string;
            probeName: string;
            probes: boolean;
          },
        ) => {
          const source = await contractSource(options);
          const contract = contractOf(source);
          const directory =
            options.spec === undefined
              ? workspaceIncusDirectory(resolve(options.workspace ?? '.'))
              : managedIncusDirectory(await stateDirectoryOf(options.spec));
          const tls = await readIncusCredentials(directory);
          const client = new IncusClient({
            endpoint:
              source.declaration.endpoint ??
              `https://${source.declaration.network.gateway}:8443`,
            project: source.declaration.project,
            tls,
            signal: () => undefined,
          });
          const report = await checkNode(client, contract, {
            clientCertificate: tls.cert,
            probes: options.probes
              ? helperProbes(
                  { client, stack: contract.stack, stateRoot: directory },
                  contract,
                  options.probeImage,
                )
              : null,
            publicTarget: parsePublicTarget(options.probePublic),
            publicName: options.probeName,
          });
          if (getOutputMode().json) emitJson('incus check', report, report.ok);
          else printReport(report);
          if (!report.ok) process.exitCode = ExitCode.Precondition;
        },
      ),
    );

  command
    .command('bootstrap')
    .description(
      'Make this host ready for the workspace stack over the local Incus admin socket (needs root or incus-admin)',
    )
    .option(
      '--workspace <dir>',
      'Workspace whose tale.json declares the Incus runtime',
      '.',
    )
    .option(
      '--socket <path>',
      'The Incus unix socket',
      '/var/lib/incus/unix.socket',
    )
    .option('--sessions-project <name>', "The sandbox zone's project")
    .option('--sessions-network <name>', "The sandbox zone's bridge")
    .option(
      '--replace-server-certificate',
      'Give Incus a pinnable server certificate when its own cannot be pinned (then restart Incus)',
    )
    .option(
      '--incus-dir <dir>',
      "Incus's state directory, for --replace-server-certificate",
      '/var/lib/incus',
    )
    .option('--remove', 'Remove what bootstrap made, instead')
    .option(
      '-y, --yes',
      'Apply the plan without asking (the firewall is always asked)',
    )
    .action(
      action(
        async (options: {
          workspace: string;
          socket: string;
          sessionsProject?: string;
          sessionsNetwork?: string;
          replaceServerCertificate?: boolean;
          incusDir: string;
          remove?: boolean;
          yes?: boolean;
        }) => {
          const workspace = resolve(options.workspace);
          const source = await workspaceContractSource(workspace, pkg.version);
          const contract = contractOf(source);
          const defaults = defaultSessionsZone(source.declaration);
          const bootstrap = {
            admin: createUnixSocketClient({
              socketPath: options.socket,
              project: source.declaration.project,
              signal: () => undefined,
            }),
            contract,
            declaration: source.declaration,
            workspace,
            zone: {
              project: options.sessionsProject ?? defaults.project,
              network: options.sessionsNetwork ?? defaults.network,
              profile: defaults.profile,
            },
            run: hostCommand,
            replaceServerCertificate: options.replaceServerCertificate === true,
            incusDirectory: options.incusDir,
          };
          const plan = options.remove
            ? await planRemoval(bootstrap)
            : await planBootstrap(bootstrap);
          printPlan(
            plan,
            options.remove
              ? 'Removing what bootstrap made'
              : 'Bootstrapping the Incus node',
          );
          if (plan.refusals.length > 0)
            throw preconditionError(
              'Bootstrap cannot go on while the refusals above stand.',
            );
          const changes = plan.steps.filter((step) => step.action !== 'keep');
          if (changes.length > 0) {
            const go = await confirm({
              message: options.remove
                ? 'Remove these objects?'
                : 'Apply this plan?',
              default: true,
              ...(options.yes ? { assumeYes: true } : {}),
            });
            if (!go) {
              logger.warn('Nothing was changed.');
              return;
            }
            await plan.apply();
          }
          if (
            await firewallConsent(
              plan.firewall,
              options.remove ? 'remove' : 'apply',
            )
          )
            await (options.remove ? removeFirewall : applyFirewall)(
              hostCommand,
              plan.firewall,
            );
          if (changes.length === 0 && plan.firewall.length === 0)
            logger.success(
              options.remove
                ? 'Nothing that bootstrap made is left.'
                : 'The node already holds what the contract needs.',
            );
          else
            logger.success(
              options.remove
                ? 'Removed.'
                : 'Bootstrapped. Run tale incus check next.',
            );
        },
      ),
    );

  return command;
}
