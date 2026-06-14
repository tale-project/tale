import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Smoke tests for the compiled `tale` binary. Skipped unless TALE_BINARY
 * points at a binary (CI sets it after `bun run build:<platform>`), so a
 * plain `bun test` (turbo, or the pre-build unit-test step) passes
 * without one. Only the hermetic command surface is exercised — nothing
 * here touches Docker or the network, so the suite runs identically on
 * Linux, macOS, and Windows runners.
 *
 * Assertions use `.includes()` rather than exact matches: logger output
 * carries `[HH:MM:SS] LEVEL` prefixes and line endings differ on Windows.
 */
const BIN = process.env.TALE_BINARY ? resolve(process.env.TALE_BINARY) : null;

// First execution of a freshly compiled binary can be slow on Windows
// runners (Defender scans the new .exe).
const SMOKE_TIMEOUT = 30_000;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(args: string[], cwd: string): Promise<RunResult> {
  if (!BIN) throw new Error('TALE_BINARY is not set');
  const proc = Bun.spawn([BIN, ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!BIN)('tale binary smoke tests', () => {
  let dir: string;

  beforeEach(async () => {
    // realpath: macOS mkdtemp returns /var/... which symlinks to
    // /private/var/... — normalize before any path-based assertion.
    dir = await realpath(await mkdtemp(join(tmpdir(), 'tale-smoke-')));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test(
    '--version prints a version and exits 0',
    async () => {
      const result = await run(['--version'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).not.toBe('');
    },
    SMOKE_TIMEOUT,
  );

  test(
    '--help lists the grouped command surface with examples',
    async () => {
      const result = await run(['--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        'Tale CLI - deployment and management tools',
      );
      for (const command of ['setup', 'init', 'config', 'doctor', 'status']) {
        expect(result.stdout).toContain(command);
      }
      // Grouped overview + examples (the "clear overview" requirement).
      for (const section of ['Setup:', 'Operate:', 'Maintain:', 'Examples:']) {
        expect(result.stdout).toContain(section);
      }
    },
    SMOKE_TIMEOUT,
  );

  test(
    'setup --help documents the guided entry point',
    async () => {
      const result = await run(['setup', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('-y, --yes');
      expect(result.stdout.toLowerCase()).toContain('docker');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'bare invocation prints the branded grouped overview and exits 0',
    async () => {
      const result = await run([], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tale');
      expect(result.stdout).toContain('Setup:');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'init --help documents the hermetic flags',
    async () => {
      const result = await run(['init', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('-f, --force');
      expect(result.stdout).toContain('--no-env');
    },
    SMOKE_TIMEOUT,
  );

  // `start` and `deploy` are the two launch commands but were never exercised
  // in the compiled binary — a crash in their import graph (or a SIGKILL on
  // load) would slip past the grep-only bundle check. Parsing `--help` proves
  // the command and its whole dependency tree load and run without dying.
  test(
    'start --help loads and documents the launch surface',
    async () => {
      const result = await run(['start', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Start Tale platform');
      expect(result.stdout).toContain('--detach');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'deploy --help loads and documents the launch surface',
    async () => {
      const result = await run(['deploy', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain('deploy');
      expect(result.stdout).toContain('--dry-run');
    },
    SMOKE_TIMEOUT,
  );

  // doctor runs real preflight checks (docker CLI, daemon, gVisor, userns,
  // sandbox token). Every docker probe is timeout-bounded, so the command must
  // terminate with a real verdict — never hang or get SIGKILLed — whatever the
  // daemon's state. A regression that drops a timeout would hang this test.
  test(
    'doctor runs every preflight check and exits without hanging',
    async () => {
      const result = await run(['doctor'], dir);
      expect([0, 1]).toContain(result.exitCode);
      expect(`${result.stdout}${result.stderr}`).toContain('docker');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'init scaffolds a complete project without .env',
    async () => {
      const result = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tale project initialized!');

      const proj = join(dir, 'proj');

      const taleJson = JSON.parse(
        await readFile(join(proj, 'tale.json'), 'utf-8'),
      );
      expect(typeof taleJson.id).toBe('string');
      expect(taleJson.id).not.toBe('');
      expect(typeof taleJson.cliVersion).toBe('string');
      expect(typeof taleJson.version).toBe('number');
      expect(Number.isNaN(Date.parse(taleJson.createdAt))).toBe(false);

      const checksums = JSON.parse(
        await readFile(join(proj, '.tale', 'checksums.json'), 'utf-8'),
      );
      // Keys use the native separator (init builds them with path.join),
      // so assert only on count — never on separator shape.
      expect(Object.keys(checksums.files).length).toBeGreaterThan(0);

      const reference = await readdir(join(proj, '.tale', 'reference'));
      expect(reference.length).toBeGreaterThan(0);

      for (const domain of [
        'agents',
        'workflows',
        'integrations',
        'providers',
        'skills',
      ]) {
        expect(existsSync(join(proj, 'default', domain))).toBe(true);
      }

      const branding = await readFile(
        join(proj, 'default', 'branding', 'branding.json'),
        'utf-8',
      );
      expect(branding.trim()).toBe('{}');
      expect(
        existsSync(join(proj, 'default', 'branding', 'images', '.gitkeep')),
      ).toBe(true);

      for (const rulesFile of [
        'CLAUDE.md',
        join('.cursor', 'rules', 'tale.mdc'),
        join('.github', 'copilot-instructions.md'),
        '.windsurfrules',
      ]) {
        expect(existsSync(join(proj, rulesFile))).toBe(true);
      }

      const gitignore = await readFile(join(proj, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('.tale/');
      expect(gitignore).toContain('.env');

      // --no-env honored: no .env scaffolded.
      expect(existsSync(join(proj, '.env'))).toBe(false);
    },
    SMOKE_TIMEOUT,
  );

  test(
    'init refuses to overwrite an existing project without --force',
    async () => {
      const first = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(first.exitCode).toBe(0);

      const second = await run(['init', 'proj'], dir);
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain('Use --force to overwrite');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'reinit with --force preserves the project id',
    async () => {
      const first = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(first.exitCode).toBe(0);
      const taleJsonPath = join(dir, 'proj', 'tale.json');
      const { id } = JSON.parse(await readFile(taleJsonPath, 'utf-8'));

      const second = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(second.exitCode).toBe(0);
      const reinit = JSON.parse(await readFile(taleJsonPath, 'utf-8'));
      expect(reinit.id).toBe(id);
    },
    SMOKE_TIMEOUT,
  );

  test(
    'config show reports the project directory inside a project',
    async () => {
      const init = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(init.exitCode).toBe(0);

      const result = await run(['config', 'show'], join(dir, 'proj'));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tale CLI Configuration');
      expect(result.stdout).toContain('Project directory');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'config show degrades gracefully outside a project',
    async () => {
      const result = await run(['config', 'show'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        'No Tale project found in current directory tree.',
      );
    },
    SMOKE_TIMEOUT,
  );

  test(
    'status fails with guidance outside a project',
    async () => {
      const result = await run(['status'], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        'No Tale project found. Run "tale init" first',
      );
    },
    SMOKE_TIMEOUT,
  );

  test(
    'unknown commands exit non-zero with an error',
    async () => {
      const result = await run(['definitely-not-a-command'], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('unknown command');
    },
    SMOKE_TIMEOUT,
  );
});
