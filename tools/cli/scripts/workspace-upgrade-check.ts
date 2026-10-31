/**
 * Upgrade a real `tale deploy` workspace from an older release with the CLI
 * under test, and prove what an operator relies on: the deploy succeeds, the
 * accounts and organizations made on the old release survive and still sign
 * in, the migrations land, a second deploy is ordinary, and a rollback across
 * the automation writer protocol cutover is refused.
 *
 *   bun tools/cli/scripts/workspace-upgrade-check.ts \
 *     --from 0.5.77 --cli ./dist/tale --workdir "$RUNNER_TEMP/upgrade"
 *
 * `--cli` is a compiled CLI stamped with a published release: its images are
 * the target. The workspace starts on `--from`'s own CLI and images, installed
 * by `scripts/install-cli.sh`. It needs Docker, ports 80 and 443, and network
 * access to GitHub and GHCR, and touches nothing outside `--workdir` and its
 * own Compose project (`tale reset --all` removes that unless `--keep`).
 *
 * From v0.5.79 until this check existed, every `tale deploy` refused a
 * v0.5.77 workspace at the protocol cutover and nothing ran the upgrade an
 * operator runs. This is that run.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dir, '../../..');

export interface UpgradeCheckOptions {
  from: string;
  cli: string;
  workdir: string;
  keep: boolean;
}

const VERSION = /^\d+\.\d+\.\d+$/;

export function parseUpgradeCheckArgs(
  args: readonly string[],
): UpgradeCheckOptions {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    const found = index === -1 ? undefined : args[index + 1];
    if (found === undefined || found.startsWith('--'))
      throw new Error(`${flag} <value> is required`);
    return found;
  };
  const from = value('--from');
  if (!VERSION.test(from)) throw new Error(`--from must be x.y.z, got ${from}`);
  return {
    from,
    cli: resolve(value('--cli')),
    workdir: resolve(value('--workdir')),
    keep: args.includes('--keep'),
  };
}

/** Writer protocol 2 starts at v0.5.78; a workspace older than that crosses
 * the cutover once, and can never be rolled back across it. */
export function crossesCutover(from: string): boolean {
  const [major, minor, patch] = from.split('.').map(Number);
  return major === 0 && (minor < 5 || (minor === 5 && patch < 78));
}

/** What must survive the upgrade, read straight from the bundled database. */
export const FINGERPRINT_SQL = `select 'users', count(*)::text from public."user";
select 'organizations', coalesce(string_agg(slug, ',' order by slug), '') from public.organization;
select 'members', count(*)::text from public.member;`;

export function parseFingerprint(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split('|');
        return [key, rest.join('|')];
      }),
  );
}

interface Ran {
  code: number;
  output: string;
}

async function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string>; stdin?: string },
): Promise<Ran> {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new Blob([options.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const decoder = new TextDecoder();
  let output = '';
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      output += text;
      process.stdout.write(text);
    }
  };
  await Promise.all([pump(child.stdout), pump(child.stderr)]);
  return { code: await child.exited, output };
}

async function must(
  label: string,
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string>; stdin?: string },
): Promise<string> {
  const ran = await run(command, args, options);
  if (ran.code !== 0) throw new Error(`${label} failed (exit ${ran.code})`);
  return ran.output;
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Upgrade check failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

/** The workspace serves localhost with a certificate from its proxy's own
 * local authority; requests verify against that root, and only it. */
let workspaceRoot: string | undefined;

async function api(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; json: unknown; cookie: string }> {
  if (workspaceRoot === undefined)
    throw new Error('The workspace root certificate was not read yet.');
  const response = await fetch(`https://localhost${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://localhost',
      ...(init.cookie ? { Cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    tls: { ca: workspaceRoot },
  });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, json, cookie };
}

async function runUpgradeCheck(options: UpgradeCheckOptions): Promise<void> {
  const { from, cli, workdir } = options;
  const workspace = join(workdir, 'ws');
  const fromCli = join(workdir, 'from-bin', 'tale');
  const updateCli = join(workdir, 'update-bin', 'tale');
  mkdirSync(join(workdir, 'from-bin'), { recursive: true });
  mkdirSync(join(workdir, 'update-bin'), { recursive: true });
  const to = (
    await must('the CLI under test', cli, ['--version'], { cwd: workdir })
  ).trim();
  check(
    VERSION.test(to),
    `the CLI under test is stamped with a release (${to})`,
  );

  await must(
    'installing the old CLI',
    'bash',
    [join(repository, 'scripts/install-cli.sh')],
    {
      cwd: workdir,
      env: { VERSION: from, INSTALL_DIR: join(workdir, 'from-bin') },
    },
  );
  await must('tale init', fromCli, ['--yes', '--ci', 'init', workspace], {
    cwd: workdir,
  });
  const project = JSON.parse(readFileSync(join(workspace, 'tale.json'), 'utf8'))
    .id as string;
  check(
    /^[a-z][a-z0-9-]*$/.test(project),
    `the workspace project is ${project}`,
  );
  const psql = async () =>
    parseFingerprint(
      await must(
        'reading the database',
        'docker',
        [
          'exec',
          '-i',
          `${project}-db`,
          'sh',
          '-c',
          'psql -X -A -t -q -h /var/run/postgresql -U "${DB_USER:-$POSTGRES_USER}" -d tale_app',
        ],
        { cwd: workdir, stdin: FINGERPRINT_SQL },
      ),
    );
  const ledger = async () =>
    (
      await must(
        'reading the ledger',
        'docker',
        [
          'exec',
          '-i',
          `${project}-db`,
          'sh',
          '-c',
          'psql -X -A -t -q -h /var/run/postgresql -U "${DB_USER:-$POSTGRES_USER}" -d tale_app',
        ],
        {
          cwd: workdir,
          stdin:
            "select name from app_migrations where name = '0163_automation_legacy_protocol.sql';",
        },
      )
    ).trim();

  try {
    await must(`deploying ${from}`, fromCli, ['--yes', '--ci', 'deploy'], {
      cwd: workspace,
    });
    workspaceRoot = await must(
      'reading the workspace root certificate',
      'docker',
      [
        'exec',
        `${project}-proxy`,
        'cat',
        '/data/caddy/pki/authorities/local/root.crt',
      ],
      { cwd: workdir },
    );

    const password = `Upgrade-${crypto.randomUUID()}-Aa1!`;
    const signUp = await api('/api/auth/sign-up/email', {
      method: 'POST',
      body: { name: 'Upgrade Owner', email: 'owner@upgrade.example', password },
    });
    check(signUp.status === 200, `an owner signs up on ${from}`);
    const owner = (signUp.json as { user?: { id?: string } }).user?.id;
    const organization = await api('/api/auth/organization/create', {
      method: 'POST',
      cookie: signUp.cookie,
      body: { name: 'Upgrade Org', slug: 'upgrade-org' },
    });
    check(
      organization.status === 200,
      `the owner creates an organization on ${from}`,
    );
    const before = await psql();
    check(
      before.organizations === 'upgrade-org',
      `the database holds what ${from} wrote`,
    );

    // The documented operator path: the old CLI moves the workspace to the
    // target release, then `tale deploy` rolls it. `-v`: releases before the
    // --version routing parse `update --version` as the program's flag.
    copyFileSync(fromCli, updateCli);
    await must(
      `tale update to ${to}`,
      updateCli,
      ['--ci', 'update', '-v', to],
      {
        cwd: workspace,
      },
    );

    const upgrade = await must(
      `deploying ${to} over ${from}`,
      cli,
      ['--yes', '--ci', 'deploy'],
      {
        cwd: workspace,
      },
    );
    if (crossesCutover(from)) {
      check(
        upgrade.includes('Automation writer protocol cutover'),
        'the deploy ran the automation writer protocol cutover',
      );
      check(
        (await ledger()) === '0163_automation_legacy_protocol.sql',
        'the database records writer protocol 2',
      );
    }
    const health = await api('/api/health');
    check(
      (health.json as { version?: string }).version === to,
      `the instance serves ${to}`,
    );
    check(
      JSON.stringify(await psql()) === JSON.stringify(before),
      'every user, organization and membership survived',
    );
    const signIn = await api('/api/auth/sign-in/email', {
      method: 'POST',
      body: { email: 'owner@upgrade.example', password },
    });
    check(
      signIn.status === 200 &&
        (signIn.json as { user?: { id?: string } }).user?.id === owner,
      `the owner from ${from} signs in on ${to}`,
    );

    // Right after the upgrade the recorded previous version is still the old
    // release; a second deploy would make it this one.
    if (crossesCutover(from)) {
      const rollback = await run(cli, ['--yes', '--ci', 'rollback'], {
        cwd: workspace,
      });
      check(
        rollback.code !== 0 && rollback.output.includes('writer protocol'),
        `rollback to ${from} is refused across the cutover`,
      );
      check(
        (await api('/api/health')).status === 200,
        `the refused rollback left ${to} serving`,
      );
    }

    await must(`deploying ${to} again`, cli, ['--yes', '--ci', 'deploy'], {
      cwd: workspace,
    });
    check(true, 'a second deploy is ordinary');
    console.log(`\nUpgrade check passed: ${from} -> ${to}`);
  } finally {
    writeFileSync(join(workdir, 'project'), project);
    if (!options.keep) {
      await run(cli, ['--yes', '--ci', 'reset', '--all', '--force'], {
        cwd: workspace,
      });
      // `reset --all` keeps the `<project>_backups` snapshots, and the CLI
      // under test may predate deleting the data volumes by name; remove
      // whatever is left of this project's own volumes.
      const volumes = (
        await run(
          'docker',
          ['volume', 'ls', '-q', '--filter', `name=^${project}_`],
          {
            cwd: workdir,
          },
        )
      ).output
        .split('\n')
        .map((name) => name.trim())
        .filter((name) => name.startsWith(`${project}_`));
      if (volumes.length > 0)
        await run('docker', ['volume', 'rm', ...volumes], { cwd: workdir });
    }
  }
}

if (import.meta.main) {
  try {
    await runUpgradeCheck(parseUpgradeCheckArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
