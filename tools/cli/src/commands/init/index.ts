import { Command, Option } from 'commander';

import { init } from '../../lib/actions/init';
import { INGRESS_MODES } from '../../lib/project/runtime-declaration';
import { RUNTIME_ENGINES } from '../../lib/runtime/types';
import { action } from '../../utils/run-command';

interface InitCommandOptions {
  force?: boolean;
  env: boolean;
  runtime?: (typeof RUNTIME_ENGINES)[number];
  incusEndpoint?: string;
  incusProject?: string;
  incusPool?: string;
  incusNetwork?: string;
  incusSubnet?: string;
  incusGateway?: string;
  incusBlock?: string;
  incusSessionsSubnet?: string;
  incusIngress?: (typeof INGRESS_MODES)[number];
  incusListen?: string;
}

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize a new Tale project directory')
    .argument('[directory]', 'target directory (defaults to current directory)')
    .option('-f, --force', 'overwrite existing tale.json')
    .option('--no-env', 'skip .env setup')
    .addOption(
      new Option(
        '--runtime <engine>',
        'container runtime to declare in tale.json (default: docker)',
      ).choices(RUNTIME_ENGINES),
    )
    .option(
      '--incus-endpoint <url>',
      'Incus API as https://<host>:<port> (default: the bridge gateway on 8443)',
    )
    .option('--incus-project <name>', 'Incus project of the stack')
    .option('--incus-pool <name>', 'Incus storage pool of the stack')
    .option('--incus-network <name>', 'Incus bridge of the stack')
    .option('--incus-subnet <cidr>', 'IPv4 subnet of the bridge')
    .option(
      '--incus-gateway <address>',
      'gateway of the bridge (default: the first host of the subnet)',
    )
    .option(
      '--incus-block <cidr>',
      'the /24 the CLI assigns addresses from (default: the subnet, when it is a /24)',
    )
    .option(
      '--incus-sessions-subnet <cidr>',
      'IPv4 subnet of the sandbox sessions',
    )
    .addOption(
      new Option(
        '--incus-ingress <mode>',
        'how the public reaches the proxy (default: proxy-device)',
      ).choices(INGRESS_MODES),
    )
    .option(
      '--incus-listen <address>',
      'host address the proxy-device ingress listens on (default: every address)',
    )
    .action(
      action(
        async (directory: string | undefined, opts: InitCommandOptions) => {
          await init({
            directory,
            force: opts.force,
            noEnv: !opts.env,
            runtime: {
              engine: opts.runtime,
              incus: {
                endpoint: opts.incusEndpoint,
                project: opts.incusProject,
                pool: opts.incusPool,
                network: opts.incusNetwork,
                subnet: opts.incusSubnet,
                gateway: opts.incusGateway,
                block: opts.incusBlock,
                sessionsSubnet: opts.incusSessionsSubnet,
                ingress: opts.incusIngress,
                listen: opts.incusListen,
              },
            },
          });
        },
      ),
    );
}
