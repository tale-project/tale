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
import {
  resolveOutputMode,
  setActiveOutputMode,
} from '../../utils/output-mode';
import { isInteractive } from '../../utils/prompt';
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

/**
 * Docker, the preflight, the rollout itself and the terminal, recorded
 * instead of run. The terminal answers `answer` to every question.
 */
function stubs(terminal: { interactive?: boolean; answer?: boolean } = {}) {
  const calls: {
    project: number;
    docker: number;
    preflight?: PreflightCall;
    deploy?: DeployCall;
  } = { project: 0, docker: 0 };
  const questions: string[] = [];
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
    confirm: async (message) => {
      questions.push(message);
      return terminal.answer ?? false;
    },
    isInteractive: () => terminal.interactive ?? false,
  };
  return { calls, deps, questions };
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

describe('tale deploy --override-all asks before anything changes (#5175)', () => {
  const ttys = {
    stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
    stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  };

  /** A terminal on one end, a pipe on the other: CI, or `| tee deploy.log`. */
  function pipe(piped: 'stdin' | 'stdout'): void {
    for (const stream of ['stdin', 'stdout'] as const) {
      Object.defineProperty(process[stream], 'isTTY', {
        value: stream === piped ? undefined : true,
        configurable: true,
      });
    }
  }

  beforeEach(() => {
    setActiveOutputMode(resolveOutputMode({}, {}));
  });

  afterEach(() => {
    setActiveOutputMode(resolveOutputMode({}, {}));
    for (const stream of ['stdin', 'stdout'] as const) {
      const descriptor = ttys[stream];
      if (descriptor)
        Object.defineProperty(process[stream], 'isTTY', descriptor);
      else delete (process[stream] as { isTTY?: boolean }).isTTY;
    }
  });

  for (const piped of ['stdin', 'stdout'] as const) {
    test(`with ${piped} piped and no --yes it refuses before Docker, the project ID or the rollout`, async () => {
      writeTaleJson();
      const project = readFileSync(join(dir, 'tale.json'), 'utf-8');
      pipe(piped);
      const { calls, deps, questions } = stubs();

      const error = await runDeploy(
        { overrideAll: true },
        { ...deps, isInteractive },
      ).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).info).toMatchObject({
        summary:
          '--override-all requires --yes (-y) without an interactive terminal (e.g. CI). Nothing was changed.',
        next: 'tale deploy --override-all --yes',
        code: ExitCode.UserAbort,
      });
      expect(questions).toEqual([]);
      expect(calls).toEqual({ project: 1, docker: 0 });
      expect(readFileSync(join(dir, 'tale.json'), 'utf-8')).toBe(project);
      expect(existsSync(join(dir, '.env'))).toBe(false);
    });
  }

  test('a declined question ends the run before Docker, the project ID or the rollout', async () => {
    writeTaleJson();
    const project = readFileSync(join(dir, 'tale.json'), 'utf-8');
    const { calls, deps, questions } = stubs({
      interactive: true,
      answer: false,
    });

    const error = await runDeploy({ overrideAll: true }, deps).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).info).toMatchObject({
      summary: '--override-all was not confirmed. Nothing was changed.',
      code: ExitCode.UserAbort,
    });
    expect(questions).toEqual([
      expect.stringContaining(
        '--override-all will factory-reset every registered org',
      ),
    ]);
    expect(calls).toEqual({ project: 1, docker: 0 });
    expect(readFileSync(join(dir, 'tale.json'), 'utf-8')).toBe(project);
    expect(existsSync(join(dir, '.env'))).toBe(false);
  });

  test('a confirmed run asks once, then deploys with --stop and a recreation for the reseed', async () => {
    writeTaleJson('demo-abc123');
    await writeDotEnv({
      HOST: 'demo.tale.dev',
      SITE_URL: 'https://demo.tale.dev',
      TLS_MODE: 'external',
    });
    spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps, questions } = stubs({
      interactive: true,
      answer: true,
    });

    await runDeploy({ overrideAll: true }, deps);

    expect(questions).toHaveLength(1);
    expect(calls.docker).toBe(1);
    expect(calls.deploy).toMatchObject({
      dryRun: false,
      overrideAll: true,
      stop: true,
      forceRecreate: true,
    });
  });

  for (const [form, yes, globalYes] of [
    ['`tale deploy --yes`', true, false],
    ['the global `tale -y`', undefined, true],
  ] as const) {
    test(`${form} consents without asking`, async () => {
      writeTaleJson('demo-abc123');
      await writeDotEnv({
        HOST: 'demo.tale.dev',
        SITE_URL: 'https://demo.tale.dev',
        TLS_MODE: 'external',
      });
      spyOn(logger, 'info').mockImplementation(() => {});
      setActiveOutputMode(resolveOutputMode({ yes: globalYes }, {}));
      const { calls, deps, questions } = stubs();

      await runDeploy({ overrideAll: true, yes }, deps);

      expect(questions).toEqual([]);
      expect(calls.deploy).toMatchObject({ overrideAll: true, stop: true });
    });
  }

  test('--dry-run asks nothing and previews the reseed', async () => {
    writeTaleJson('demo-abc123');
    spyOn(logger, 'info').mockImplementation(() => {});
    const { calls, deps, questions } = stubs();

    await runDeploy({ overrideAll: true, dryRun: true }, deps);

    expect(questions).toEqual([]);
    expect(calls.deploy).toMatchObject({ dryRun: true, overrideAll: true });
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

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).info).toEqual({
      summary: invalidProjectIdMessage('2024_site'),
      code: ExitCode.Precondition,
    });
    expect(calls).toEqual({ project: 1, docker: 0 });
  });
});
