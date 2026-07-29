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
    '--help lists the grouped command surface',
    async () => {
      const result = await run(['--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        'Tale CLI - deployment and management tools',
      );
      for (const command of ['init', 'dev', 'deploy', 'config', 'status']) {
        expect(result.stdout).toContain(command);
      }
      // Grouped overview headings (the "clear overview" requirement).
      for (const section of ['Setup:', 'Operate:', 'Maintain:']) {
        expect(result.stdout).toContain(section);
      }
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

  // `dev` and `deploy` are the two launch commands but were never exercised
  // in the compiled binary — a crash in their import graph (or a SIGKILL on
  // load) would slip past the grep-only bundle check. Parsing `--help` proves
  // the command and its whole dependency tree load and run without dying.
  test(
    'dev --help loads and documents the launch surface',
    async () => {
      const result = await run(['dev', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Run Tale locally');
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

  test(
    'uninstall --help documents the removal flags',
    async () => {
      const result = await run(['uninstall', '--help'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain('remove the tale cli');
      expect(result.stdout).toContain('-f, --force');
      expect(result.stdout).toContain('--purge');
      expect(result.stdout).toContain('--dry-run');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'uninstall --dry-run is non-destructive and leaves the binary working',
    async () => {
      // The command loads, never prompts, and removes nothing. Exit 0 on a
      // release binary (dry-run previews) or 3 on a `-dev` binary (the dev
      // guard refuses) — both are non-destructive. The binary must still run
      // afterward, which is the invariant that matters regardless of build.
      const result = await run(['uninstall', '--dry-run'], dir);
      expect([0, 3]).toContain(result.exitCode);

      const version = await run(['--version'], dir);
      expect(version.exitCode).toBe(0);
      expect(version.stdout.trim()).not.toBe('');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'dev from a parent dir points at the child project, not a re-init',
    async () => {
      // init scaffolds into ./proj; running `tale dev` from the parent must
      // guide the user to cd into it — NOT silently initialize a second
      // project on top (the "No Tale project found. Initializing…" footgun).
      const init = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(init.exitCode).toBe(0);

      const result = await run(['dev'], dir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('cd proj');
      expect(`${result.stdout}${result.stderr}`).not.toContain(
        'Initializing in current directory',
      );
    },
    SMOKE_TIMEOUT,
  );

  test(
    'init scaffolds a complete project without .env',
    async () => {
      const result = await run(['init', 'proj', '--force', '--no-env'], dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Tale project initialized!');

      // The summary reports active vs catalog instead of raw file counts —
      // only `metadata.autoInstall: true` agents are live on a new org.
      expect(result.stdout).toContain('in catalog');
      expect(result.stdout).toContain('available');

      const proj = join(dir, 'proj');

      // default/ self-documents the active-vs-catalog rule.
      expect(existsSync(join(proj, 'default', 'README.md'))).toBe(true);

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
        'connectors',
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

      // Agent instructions: AGENTS.md holds the full Tale guidance and
      // CLAUDE.md points at it. The per-tool rules files are no longer
      // scaffolded.
      expect(existsSync(join(proj, 'AGENTS.md'))).toBe(true);
      const claudeMd = await readFile(join(proj, 'CLAUDE.md'), 'utf-8');
      expect(claudeMd).toContain('AGENTS.md');
      for (const dropped of [
        join('.cursor', 'rules', 'tale.mdc'),
        join('.github', 'copilot-instructions.md'),
        '.windsurfrules',
      ]) {
        expect(existsSync(join(proj, dropped))).toBe(false);
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
    'init writes a non-interactive local-default .env (no prompts, no Docker)',
    async () => {
      // Without --no-env, init writes a ready-to-run local .env: localhost +
      // self-signed + generated secrets. It must work in this non-TTY harness
      // (no "How will you run Tale?" prompt, no Docker contact).
      const result = await run(['init', 'proj', '--force'], dir);
      expect(result.exitCode).toBe(0);
      const env = await readFile(join(dir, 'proj', '.env'), 'utf-8');
      expect(env).toContain('HOST=localhost');
      expect(env).toContain('TLS_MODE=selfsigned');
      expect(env).toMatch(/SANDBOX_TOKEN=.+/);
      expect(env).toMatch(/SOPS_AGE_KEY=.+/);
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
    'status fails with a precondition exit code + guidance outside a project',
    async () => {
      const result = await run(['status'], dir);
      // Exit 3 = precondition (no project); the summary is on stderr and the
      // copy-pasteable next step (`tale init`) is in the rendered detail.
      expect(result.exitCode).toBe(3);
      expect(result.stderr).toContain('No Tale project found.');
      expect(result.stdout + result.stderr).toContain('tale init');
    },
    SMOKE_TIMEOUT,
  );

  test(
    'status --json outside a project emits one JSON error envelope (exit 3)',
    async () => {
      const result = await run(['--json', 'status'], dir);
      expect(result.exitCode).toBe(3);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe(3);
      // No ANSI escapes on the machine-readable stream.
      expect(result.stdout).not.toContain('\x1b');
      // Nothing leaks to stderr — the error envelope is the whole output.
      expect(result.stderr).toBe('');
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
