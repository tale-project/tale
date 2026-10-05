import { beforeAll, expect, test } from 'bun:test';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This real-engine suite is run explicitly by SAST after the runner has made
// its pinned binary available. Ordinary Unit and native CLI lanes do not run it.
const sourceRunner = fileURLToPath(new URL('./run.sh', import.meta.url));
const runner = await readFile(sourceRunner, 'utf8');
const version = runner.match(/^OPENGREP_VERSION="(v\d+\.\d+\.\d+)"$/m)?.[1];
if (!version)
  throw new Error('The runner must declare its pinned engine version');
const binary = join(
  process.env.OPENGREP_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'opengrep'),
  version,
  'opengrep',
);

beforeAll(async () => {
  // Fail closed; this suite must never silently skip or provision another engine.
  await access(binary, constants.X_OK);
  const process = Bun.spawn([binary, '--version'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [actualVersion, , exit] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  expect(exit).toBe(0);
  expect(actualVersion.trim()).toBe(version.slice(1));
});

const config = `rules:
  - id: probe-error
    languages: [typescript]
    severity: ERROR
    message: active error diagnostic
    pattern: errorProbe(...)
  - id: probe-warning
    languages: [typescript]
    severity: WARNING
    message: active warning diagnostic
    pattern: warningProbe(...)
  - id: probe-info
    languages: [typescript]
    severity: INFO
    message: excluded info diagnostic
    pattern: infoProbe(...)
  - id: probe-excluded
    languages: [typescript]
    severity: ERROR
    message: excluded rule diagnostic
    pattern: excludedProbe(...)
`;
const registry = `rules:
  - id: probe-vendored
    languages: [typescript]
    severity: WARNING
    message: active vendored diagnostic
    pattern: vendoredProbe(...)
`;

type SarifReport = {
  version: string;
  runs: Array<{
    results: Array<{
      ruleId: string;
      suppressions?: Array<{ kind: string }>;
    }>;
  }>;
};

async function scan(
  source: string,
  reporting: boolean,
  invalidConfig = false,
  reportWriteFailure = false,
) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'tale-opengrep-run-')),
  );
  try {
    const tools = join(directory, 'tools/opengrep');
    const cache = join(directory, 'cache');
    const tracedBinary = join(cache, version, 'opengrep');
    const trace = join(directory, 'invocations');
    const sarif = join(directory, 'report.sarif');
    await mkdir(tools, { recursive: true });
    await mkdir(dirname(tracedBinary), { recursive: true });
    await mkdir(join(directory, 'ignored'), { recursive: true });
    await writeFile(join(tools, 'run.sh'), runner);
    await writeFile(
      join(tools, 'config.yml'),
      invalidConfig ? 'rules: [unclosed\n' : config,
    );
    await mkdir(join(tools, 'rules'));
    await writeFile(join(tools, 'rules/registry-pinned.yml'), registry);
    await writeFile(
      join(tools, 'excluded-rules.txt'),
      'tools.opengrep.probe-excluded\n',
    );
    await writeFile(join(directory, '.opengrepignore'), '**/ignored/**\n');
    await writeFile(
      join(directory, 'ignored/source.ts'),
      'errorProbe(9); warningProbe(9);\n',
    );
    await writeFile(join(directory, 'source.ts'), source);
    await writeFile(
      tracedBinary,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'BEGIN\\0' >> "\${OPENGREP_TEST_TRACE}"
printf '%s\\0' "$@" >> "\${OPENGREP_TEST_TRACE}"
exec "\${OPENGREP_TEST_BINARY}" "$@"
`,
    );
    await chmod(tracedBinary, 0o755);
    const process = Bun.spawn(['bash', join(tools, 'run.sh'), directory], {
      cwd: directory,
      env: {
        ...Bun.env,
        OPENGREP_CACHE_DIR: cache,
        OPENGREP_LOCAL_ONLY: '',
        OPENGREP_SKIP_IF_UNCACHED: '',
        OPENGREP_SARIF_OUTPUT: reporting
          ? reportWriteFailure
            ? join(directory, 'ignored')
            : sarif
          : '',
        OPENGREP_TEST_TRACE: trace,
        OPENGREP_TEST_BINARY: binary,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    const args = (await readFile(trace, 'utf8')).split('\0').filter(Boolean);
    expect(args.filter((argument) => argument === 'BEGIN')).toHaveLength(1);
    expect(args.slice(0, 2)).toEqual(['BEGIN', 'scan']);
    expect(args).toContain('--error');
    expect(args).toContain('--severity=ERROR');
    expect(args).toContain('--severity=WARNING');
    expect(args.some((argument) => argument.includes('severity=INFO'))).toBe(
      false,
    );
    expect(args).toContain(join(tools, 'config.yml'));
    expect(args).toContain(join(tools, 'rules/registry-pinned.yml'));
    expect(args).toContain('--exclude=**/ignored/**');
    expect(args).toContain('--exclude-rule=tools.opengrep.probe-excluded');
    expect(args.at(-1)).toBe(directory);
    if (reporting) {
      expect(args).toContain(
        `--sarif-output=${reportWriteFailure ? join(directory, 'ignored') : sarif}`,
      );
    } else {
      expect(args.some((argument) => argument.includes('sarif-output'))).toBe(
        false,
      );
      expect(args.some((argument) => argument.includes('json-output'))).toBe(
        false,
      );
    }
    const report: SarifReport | undefined =
      reporting && !reportWriteFailure
        ? JSON.parse(await readFile(sarif, 'utf8'))
        : undefined;
    if (report) expect(report.version).toBe('2.1.0');
    return {
      exit,
      stdout,
      stderr,
      results: report?.runs.flatMap((run) => run.results),
    };
  } finally {
    // Every removed byte was created in this test's own mkdtemp directory.
    await rm(directory, { recursive: true, force: true });
  }
}

for (const reporting of [false, true]) {
  const mode = reporting ? 'with SARIF' : 'plain';
  test(`suppressed findings and severity/path/rule exclusions pass (${mode})`, async () => {
    const result = await scan(
      'errorProbe(1); // nosemgrep: probe-error\n' +
        'warningProbe(1); // nosemgrep\n' +
        'vendoredProbe(1); // nosemgrep: probe-vendored\n' +
        'infoProbe(1); excludedProbe(1);\n',
      reporting,
    );
    expect(result.exit).toBe(0);
    expect(result.stdout).not.toContain('excluded info diagnostic');
    expect(result.stdout).not.toContain('excluded rule diagnostic');
    if (reporting) {
      expect(result.results).toHaveLength(3);
      for (const finding of result.results!) {
        expect(finding.suppressions).toEqual([{ kind: 'inSource' }]);
      }
    }
  }, 20_000);

  test(`active ERROR and WARNING findings block with readable diagnostics (${mode})`, async () => {
    const result = await scan(
      'errorProbe(1); warningProbe(1); vendoredProbe(1);\n',
      reporting,
    );
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('active error diagnostic');
    expect(result.stdout).toContain('active warning diagnostic');
    expect(result.stdout).toContain('active vendored diagnostic');
    if (reporting) {
      expect(result.results).toHaveLength(3);
      expect(result.results!.every((finding) => !finding.suppressions)).toBe(
        true,
      );
    }
  }, 20_000);

  if (reporting)
    test(`an unsuppressed WARNING still blocks mixed findings (${mode})`, async () => {
      const result = await scan(
        'errorProbe(1); // nosemgrep\nvendoredProbe(1); // nosemgrep: probe-error\n',
        reporting,
      );
      expect(result.exit).toBe(1);
      expect(result.stdout).toContain('active vendored diagnostic');
      if (reporting) {
        expect(result.results).toHaveLength(2);
        expect(
          result.results!.find((finding) =>
            finding.ruleId.endsWith('.probe-error'),
          )?.suppressions,
        ).toEqual([{ kind: 'inSource' }]);
        expect(
          result.results!.find((finding) =>
            finding.ruleId.endsWith('.probe-vendored'),
          )?.suppressions,
        ).toBeUndefined();
      }
    }, 20_000);

  test(`fatal invalid configuration remains nonzero (${mode})`, async () => {
    const result = await scan('ordinaryValue();\n', reporting, true);
    expect(result.exit).toBe(7);
    // The engine routes text diagnostics to stdout in GitHub Actions.
    expect(`${result.stdout}\n${result.stderr}`).toContain('Invalid YAML');
  }, 20_000);
}

// A reporting failure must not turn any source verdict into success. The
// engine owns its failure status; the wrapper must never swallow it.
test.each(['ordinaryValue();\n', 'errorProbe(1);\n'])(
  'a genuine SARIF write failure remains nonzero for %s',
  async (source) => {
    const result = await scan(source, true, false, true);
    expect(result.exit).toBe(2);
    expect(`${result.stdout}\n${result.stderr}`).toContain('Is a directory');
  },
  20_000,
);
