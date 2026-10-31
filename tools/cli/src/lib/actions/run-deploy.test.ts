import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliError, ExitCode } from '../../utils/fail';
import * as logger from '../../utils/logger';
import { ensureEnv, setEnvVars } from '../config/ensure-env';
import { invalidProjectIdMessage } from '../project/generate-project-id';
import { type RunDeployDeps, runDeploy } from './run-deploy';

type DeployCall = Parameters<RunDeployDeps['deploy']>[0];
type PreflightCall = Parameters<RunDeployDeps['runDeployPreflight']>[0];

let dir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tale-run-deploy-'));
  // loadEnv folds .env into process.env without overriding what is set.
  savedEnv = { ...process.env };
  for (const key of ['HOST', 'SITE_URL', 'TLS_MODE', 'TLS_EMAIL']) {
    delete process.env[key];
  }
});

afterEach(() => {
  mock.restore();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  rmSync(dir, { recursive: true, force: true });
});

function writeTaleJson(id?: string): void {
  writeFileSync(
    join(dir, 'tale.json'),
    `${JSON.stringify({ version: 1, cliVersion: '0.5.94', createdAt: '2026-01-01T00:00:00.000Z', ...(id ? { id } : {}) }, null, 2)}\n`,
  );
}

/** A complete .env, as `tale init` writes it, with these settings. */
async function writeDotEnv(settings: Record<string, string>): Promise<void> {
  await ensureEnv({ deployDir: dir });
  await setEnvVars(dir, settings);
}

function readDotEnv(): string {
  return readFileSync(join(dir, '.env'), 'utf-8');
}

/** Docker, the preflight and the rollout itself, recorded instead of run. */
function stubs() {
  const calls: {
    project: number;
    docker: number;
    preflight?: PreflightCall;
    deploy?: DeployCall;
  } = { project: 0, docker: 0 };
  const deps: RunDeployDeps = {
    requireProject: () => {
      calls.project++;
      return dir;
    },
    ensureDocker: async () => {
      calls.docker++;
      return { status: 'ready', detail: 'stub' };
    },
    runDeployPreflight: async (options) => {
      calls.preflight = options;
      return { ok: true, blocking: [] };
    },
    checkBreakingCutover: async () => {},
    deploy: async (options) => {
      calls.deploy = options;
    },
  };
  return { calls, deps };
}

describe('tale deploy --host serves its host for one run', () => {
  test('--dry-run --host leaves .env byte-identical and previews the run', async () => {
    writeTaleJson('demo-abc123');
    await writeDotEnv({
      HOST: 'demo.tale.dev',
      SITE_URL: 'https://demo.tale.dev:8443',
      TLS_MODE: 'external',
    });
    const before = readDotEnv();
    const info = spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps } = stubs();

    await runDeploy({ dryRun: true, host: 'tale.example.com' }, deps);

    expect(readDotEnv()).toBe(before);
    expect(calls.deploy).toMatchObject({
      dryRun: true,
      hostAlias: 'tale.example.com',
      // .env's scheme and port stay; only the host is the run's.
      origin: {
        host: 'tale.example.com',
        siteUrl: 'https://tale.example.com:8443',
      },
    });
    // The preflight checks the host the run serves, under .env's TLS mode.
    expect(calls.preflight?.env).toMatchObject({
      HOST: 'tale.example.com',
      SITE_URL: 'https://tale.example.com:8443',
      TLS_MODE: 'external',
    });
    expect(process.env.HOST).toBe('demo.tale.dev');
    expect(info).toHaveBeenCalledWith(
      '[DRY-RUN] Would serve https://tale.example.com:8443 (--host tale.example.com, TLS_MODE=external). .env is not changed: set HOST and SITE_URL there to keep this host.',
    );
  });

  test('a real --host run leaves .env byte-identical', async () => {
    writeTaleJson('demo-abc123');
    // `tale init`'s local default: the old code wrote the flag's host and
    // TLS_MODE=letsencrypt here for good.
    await writeDotEnv({});
    const before = readDotEnv();
    spyOn(logger, 'info').mockImplementation(() => {});
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    const { calls, deps } = stubs();

    await runDeploy({ host: 'Tale.Example.com' }, deps);

    expect(readDotEnv()).toBe(before);
    expect(calls.deploy).toMatchObject({
      dryRun: false,
      hostAlias: 'tale.example.com',
      origin: { host: 'tale.example.com', siteUrl: 'https://tale.example.com' },
      env: { SITE_URL: 'https://tale.example.com' },
    });
    expect(warn).toHaveBeenCalledWith(
      "tale.example.com gets a self-signed certificate that browsers do not trust. For a Let's Encrypt certificate set TLS_MODE=letsencrypt and TLS_EMAIL in .env.",
    );
  });

  test('an invalid --host is a usage error before Docker or the project', async () => {
    writeTaleJson('demo-abc123');
    const { calls, deps } = stubs();

    const error = await runDeploy(
      { dryRun: true, host: 'https://tale.example.com' },
      deps,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).info.code).toBe(ExitCode.Usage);
    expect(calls).toEqual({ project: 0, docker: 0 });
  });

  test('without --host the run serves HOST from .env', async () => {
    writeTaleJson('demo-abc123');
    await writeDotEnv({
      HOST: 'demo.tale.dev',
      SITE_URL: 'https://demo.tale.dev',
      TLS_MODE: 'external',
    });
    spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps } = stubs();

    await runDeploy({ dryRun: true }, deps);

    expect(calls.deploy?.hostAlias).toBe('demo.tale.dev');
    expect(calls.deploy?.origin).toBeUndefined();
    expect(calls.preflight?.env).toBe(process.env);
  });
});

describe('tale deploy --dry-run writes nothing', () => {
  test('a project without an ID or .env keeps tale.json and gets no .env', async () => {
    writeTaleJson();
    const project = readFileSync(join(dir, 'tale.json'), 'utf-8');
    spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps } = stubs();

    await runDeploy({ dryRun: true }, deps);

    expect(existsSync(join(dir, '.env'))).toBe(false);
    expect(readFileSync(join(dir, 'tale.json'), 'utf-8')).toBe(project);
    expect(calls.deploy?.dryRun).toBe(true);
  });

  test('a missing secret leaves .env as it is and previews the recreation', async () => {
    writeTaleJson('demo-abc123');
    await writeDotEnv({
      HOST: 'demo.tale.dev',
      SITE_URL: 'https://demo.tale.dev',
      TLS_MODE: 'external',
    });
    writeFileSync(
      join(dir, '.env'),
      readDotEnv().replace(/^TALE_AUDIT_PEPPER=.*\n/m, ''),
    );
    const before = readDotEnv();
    spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps } = stubs();

    await runDeploy({ dryRun: true }, deps);

    expect(readDotEnv()).toBe(before);
    expect(calls.deploy?.forceRecreate).toBe(true);
  });
});

describe('tale deploy checks the project ID before Docker', () => {
  test('an invalid ID is refused with the rule and the fix', async () => {
    writeTaleJson('2024_site');
    const { calls, deps } = stubs();

    const error = await runDeploy({ dryRun: true }, deps).catch(
      (caught: unknown) => caught,
    );

    expect((error as Error).message).toBe(invalidProjectIdMessage('2024_site'));
    expect(calls).toEqual({ project: 1, docker: 0 });
  });
});
