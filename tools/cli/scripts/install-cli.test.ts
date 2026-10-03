import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const bashSource = (
  await readFile(join(repository, 'scripts/install-cli.sh'), 'utf8')
)
  .replace(/\r\n/g, '\n')
  .replace(/\nmain\s*$/, '\n');
const roots: string[] = [];

const downloadMocks = `
curl() {
    case "$*" in
        *tale_checksums.txt*)
            printf '%s\\n%s' "$CHECKSUM_BODY" "$CHECKSUM_STATUS"
            return "$CHECKSUM_EXIT"
            ;;
        *-sIL*) printf '200' ;;
        *)
            while [ "$#" -gt 0 ]; do
                if [ "$1" = "-o" ]; then cp "$FIXTURE_BINARY" "$2"; return; fi
                shift
            done
            return 1
            ;;
    esac
}
wget() {
    printf '  HTTP/1.1 %s Response\\n' "$CHECKSUM_STATUS" >&2
    printf '%s' "$CHECKSUM_BODY"
    return "$CHECKSUM_EXIT"
}
`;

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture(binary = '#!/bin/sh\nprintf "tale fixture 9.8.7\\n"\n') {
  const root = await mkdtemp(join(tmpdir(), 'tale-installer-'));
  roots.push(root);
  const file = join(root, 'download');
  await writeFile(file, binary, { mode: 0o755 });
  const digest = createHash('sha256').update(binary).digest('hex');
  const installDir = join(root, 'new install directory');
  return {
    root,
    file,
    binary,
    installDir,
    environment: {
      PATH: ['/usr/bin', '/bin'].join(delimiter),
      INSTALL_DIR: installDir,
      FIXTURE_BINARY: file,
      VERSION: '9.8.7',
      CHECKSUM_BODY: `${digest}  tale_linux\n${digest}  tale_linux_arm64\n${digest}  tale_macos\n${digest}  tale_macos_x64`,
      CHECKSUM_STATUS: '200',
      CHECKSUM_EXIT: '0',
    },
  };
}

function runBash(code: string, environment: Record<string, string>) {
  const run = Bun.spawnSync(['bash', '-s'], {
    stdin: Buffer.from(`${bashSource}\n${downloadMocks}\n${code}\n`),
    env: { ...process.env, ...environment },
    timeout: 10_000,
  });
  return { exitCode: run.exitCode, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(process.platform === 'win32')('Unix CLI installer', () => {
  test('installs outside PATH into a new directory with spaces and gives working PATH guidance', async () => {
    const setup = await fixture();
    const result = runBash('main', setup.environment);
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain(
      'Successfully installed tale (tale fixture 9.8.7)',
    );
    expect(await readFile(join(setup.installDir, 'tale'), 'utf8')).toBe(
      setup.binary,
    );
    const plainOutput = result.output.replace(/\u001b\[[0-9;]*m/g, '');
    const pathCommand = plainOutput
      .split('\n')
      .find((line) => line.trim().startsWith('export PATH='));
    expect(pathCommand).toBeDefined();
    const nextCommand = runBash(
      `${pathCommand}\ntale --version`,
      setup.environment,
    );
    expect(nextCommand.exitCode, nextCommand.output).toBe(0);
    expect(nextCommand.output).toContain('tale fixture 9.8.7');
  });

  test('does not approve a broken installed binary by running an older tale on PATH', async () => {
    const setup = await fixture('#!/bin/sh\nexit 7\n');
    const olderDir = join(setup.root, 'older');
    await mkdir(olderDir);
    await writeFile(
      join(olderDir, 'tale'),
      '#!/bin/sh\nprintf "old tale\\n"\n',
      { mode: 0o755 },
    );
    const result = runBash('main', {
      ...setup.environment,
      PATH: `${olderDir}${delimiter}${setup.environment.PATH}`,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('The installed binary did not run');
    expect(result.output).not.toContain('Successfully installed');
  });

  test('reports the new version and explains how to use it when an older tale shadows it', async () => {
    const setup = await fixture();
    const olderDir = join(setup.root, 'older');
    await mkdir(olderDir);
    await writeFile(
      join(olderDir, 'tale'),
      '#!/bin/sh\nprintf "old tale\\n"\n',
      { mode: 0o755 },
    );
    const result = runBash('main', {
      ...setup.environment,
      PATH: `${olderDir}${delimiter}${setup.environment.PATH}`,
    });
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain(
      'Successfully installed tale (tale fixture 9.8.7)',
    );
    expect(result.output).toContain('export PATH=');
  });

  test('does not request PATH changes when the installed binary is already selected', async () => {
    const setup = await fixture();
    const result = runBash('main', {
      ...setup.environment,
      PATH: `${setup.installDir}${delimiter}${setup.environment.PATH}`,
    });
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).not.toContain('export PATH=');
  });

  for (const downloader of ['curl', 'wget']) {
    for (const scenario of [
      {
        name: 'matching checksum',
        status: '200',
        exit: '0',
        result: 0,
        text: 'Checksum verified',
      },
      {
        name: 'legacy release without checksums',
        status: '404',
        exit: downloader === 'curl' ? '0' : '8',
        result: 0,
        text: 'No checksum file published',
      },
      {
        name: 'server failure',
        status: '503',
        exit: downloader === 'curl' ? '0' : '8',
        result: 1,
        text: 'Could not fetch the checksum file',
      },
      {
        name: 'incomplete response',
        status: '200',
        exit: '18',
        result: 1,
        text: 'Could not fetch the checksum file',
      },
      {
        name: 'missing asset entry',
        status: '200',
        exit: '0',
        body: `${'a'.repeat(64)}  another_binary`,
        result: 1,
        text: 'No checksum entry',
      },
      {
        name: 'mismatch',
        status: '200',
        exit: '0',
        body: `${'a'.repeat(64)}  tale_linux`,
        result: 1,
        text: 'Checksum mismatch',
      },
    ]) {
      test(`${downloader}: ${scenario.name}`, async () => {
        const setup = await fixture();
        const result = runBash(
          `DOWNLOADER=${downloader}\nASSET_NAME=tale_linux\nverify_checksum "$FIXTURE_BINARY" v9.8.7`,
          {
            ...setup.environment,
            CHECKSUM_STATUS: scenario.status,
            CHECKSUM_EXIT: scenario.exit,
            ...(scenario.body ? { CHECKSUM_BODY: scenario.body } : {}),
          },
        );
        expect(result.exitCode, result.output).toBe(scenario.result);
        expect(result.output).toContain(scenario.text);
      });
    }
  }

  test('keeps an existing installation untouched when checksum verification fails', async () => {
    const setup = await fixture();
    await mkdir(setup.installDir);
    await writeFile(join(setup.installDir, 'tale'), 'existing installation');
    const result = runBash('main', {
      ...setup.environment,
      CHECKSUM_STATUS: '503',
    });
    expect(result.exitCode).toBe(1);
    expect(await readFile(join(setup.installDir, 'tale'), 'utf8')).toBe(
      'existing installation',
    );
  });

  for (const [os, arch, asset] of [
    ['Darwin', 'arm64', 'tale_macos'],
    ['Darwin', 'x86_64', 'tale_macos_x64'],
    ['Linux', 'x86_64', 'tale_linux'],
    ['Linux', 'aarch64', 'tale_linux_arm64'],
  ]) {
    test(`selects ${asset} for ${os}/${arch}`, () => {
      const result = runBash(
        'uname() { if [ "$1" = "-s" ]; then echo "$TEST_OS"; else echo "$TEST_ARCH"; fi; }\ndetect_platform\necho "$ASSET_NAME"',
        { TEST_OS: os!, TEST_ARCH: arch! },
      );
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe(asset!);
    });
  }
});

const powershell =
  process.platform === 'win32' ? 'powershell' : Bun.which('pwsh');
const powershellSource = (
  await readFile(join(repository, 'scripts/install-cli.ps1'), 'utf8')
)
  .replace(/\r\n/g, '\n')
  .replace(/\nMain\s*$/, '\n');

function runPowerShell(code: string, environment: Record<string, string> = {}) {
  const script = `${powershellSource}\n${code}`;
  const run = Bun.spawnSync(
    [
      powershell!,
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      env: { ...process.env, ...environment },
      timeout: 10_000,
    },
  );
  return { exitCode: run.exitCode, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(!powershell)('PowerShell CLI installer', () => {
  test('resolves relative install directories from the current PowerShell location', async () => {
    const setup = await fixture();
    const result = runPowerShell(
      'Set-Location -LiteralPath $env:TEST_ROOT; Resolve-InstallDir "relative tools"',
      { TEST_ROOT: setup.root },
    );
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output.trim()).toBe(join(setup.root, 'relative tools'));
  });

  for (const scenario of [
    { name: 'empty path', before: '', after: 'C:\\Tools\\tale' },
    {
      name: 'similar directory names',
      before: 'C:\\Tools\\tale-old;C:\\Windows',
      after: 'C:\\Tools\\tale;C:\\Tools\\tale-old;C:\\Windows',
    },
    {
      name: 'quoted case-insensitive duplicate',
      before: 'C:\\Windows;"c:\\TOOLS\\TALE\\"',
      after: 'C:\\Tools\\tale;C:\\Windows',
    },
    {
      name: 'already first',
      before: 'C:\\Tools\\tale;C:\\Windows',
      after: 'C:\\Tools\\tale;C:\\Windows',
    },
  ]) {
    test(`prepends the install directory with ${scenario.name}`, () => {
      const result = runPowerShell(
        'Get-PathWithInstallDir $env:TEST_PATH $env:TEST_DIRECTORY',
        { TEST_PATH: scenario.before, TEST_DIRECTORY: 'C:\\Tools\\tale' },
      );
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe(scenario.after);
    });
  }

  for (const scenario of [
    {
      name: 'matching checksum',
      body: 'matching',
      result: 0,
      text: 'Checksum verified',
    },
    {
      name: 'missing asset entry',
      body: `${'a'.repeat(64)}  another_binary`,
      result: 1,
      text: 'No checksum entry',
    },
    {
      name: 'malformed checksum',
      body: 'invalid  tale_windows.exe',
      result: 1,
      text: 'Invalid checksum entry',
    },
    {
      name: 'duplicate asset entry',
      body: `${'a'.repeat(64)}  tale_windows.exe\n${'a'.repeat(64)}  tale_windows.exe`,
      result: 1,
      text: 'Invalid checksum entry',
    },
    {
      name: 'mismatch',
      body: `${'a'.repeat(64)}  tale_windows.exe`,
      result: 1,
      text: 'Checksum mismatch',
    },
  ]) {
    test(scenario.name, async () => {
      const setup = await fixture();
      const digest = createHash('sha256').update(setup.binary).digest('hex');
      const result = runPowerShell(
        `
function Invoke-WebRequest { return @{ Content = $env:CHECKSUM_BODY } }
Verify-Checksum $env:FIXTURE_BINARY v9.8.7
`,
        {
          FIXTURE_BINARY: setup.file,
          CHECKSUM_BODY:
            scenario.body === 'matching'
              ? `${digest}  tale_windows.exe`
              : scenario.body,
        },
      );
      expect(result.exitCode, result.output).toBe(scenario.result);
      expect(result.output).toContain(scenario.text);
    });
  }
});
