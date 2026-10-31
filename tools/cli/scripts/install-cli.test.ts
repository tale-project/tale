import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  // Windows temp directories may use 8.3 aliases; PowerShell resolves their long names.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tale-installer-')));
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

  const detectPlatform =
    'uname() { if [ "$1" = "-s" ]; then echo "$TEST_OS"; else echo "$TEST_ARCH"; fi; }\ndetect_platform\necho "$ASSET_NAME"';

  for (const [os, arch, asset] of [
    ['Darwin', 'arm64', 'tale_macos'],
    ['Darwin', 'x86_64', 'tale_macos_x64'],
    ['Linux', 'x86_64', 'tale_linux'],
    ['Linux', 'aarch64', 'tale_linux_arm64'],
  ]) {
    test(`selects ${asset} for ${os}/${arch}`, () => {
      const result = runBash(detectPlatform, {
        TEST_OS: os!,
        TEST_ARCH: arch!,
      });
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe(asset!);
    });
  }

  const buildFromSource =
    "If Bun (https://bun.sh) runs on this machine, build the CLI from source: clone https://github.com/tale-project/tale, run 'bun install' and then 'bun run --filter @tale/cli build:host' in the clone, and move tools/cli/dist/tale into a directory on your PATH, such as /usr/local/bin.";

  for (const [os, arch, text] of [
    [
      'Linux',
      'armv7l',
      `No released binary for linux/armv7l. ${buildFromSource}`,
    ],
    ['FreeBSD', 'amd64', `Unsupported OS: freebsd. ${buildFromSource}`],
    [
      'MINGW64_NT-10.0-26100',
      'x86_64',
      'This installer is for macOS and Linux. On Windows, run the PowerShell installer: irm https://raw.githubusercontent.com/tale-project/tale/main/scripts/install-cli.ps1 | iex',
    ],
  ]) {
    test(`points ${os}/${arch} to an install that works there`, () => {
      const result = runBash(detectPlatform, {
        TEST_OS: os!,
        TEST_ARCH: arch!,
      });
      expect(result.exitCode, result.output).toBe(1);
      expect(result.output).toContain(text!);
      expect(result.output).not.toContain("'bun run build'");
    });
  }

  test('the build-from-source hint names a script that compiles for the host', async () => {
    const build: string = JSON.parse(
      await readFile(join(repository, 'tools/cli/package.json'), 'utf8'),
    ).scripts['build:host'];
    // The generated catalog is gitignored, deploy prepare refuses a binary
    // without TALE_COMPILED, and a --target compiles for another machine.
    expect(build).toStartWith('bun run generate && ');
    expect(build).toContain('bun build --compile --define TALE_COMPILED=true ');
    expect(build).toContain(' --outfile=dist/tale ');
    expect(build).not.toContain('--target');
    expect(build).toEndWith(' && bun run check:bundle');
  });

  // GitHub's release API answers $API_BODY with $API_STATUS (no status: no
  // answer at all); the releases/latest redirect points to $LATEST_TAG (no
  // tag: the redirect fails too).
  const releaseLookup = (downloader: string) => `
curl() {
    case "$*" in
        *api.github.com*)
            if [ -z "$API_STATUS" ]; then printf '\\n000'; return 7; fi
            printf '%s\\n%s' "$API_BODY" "$API_STATUS"
            ;;
        *releases/latest*)
            [ -n "$LATEST_TAG" ] || return 6
            printf 'HTTP/2 302\\r\\nlocation: https://github.com/tale-project/tale/releases/tag/%s\\r\\n\\r\\n' "$LATEST_TAG"
            ;;
        *) return 1 ;;
    esac
}
wget() {
    case "$*" in
        *api.github.com*)
            [ -n "$API_STATUS" ] || return 4
            printf '  HTTP/1.1 %s Response\\n' "$API_STATUS" >&2
            [ "$API_STATUS" = 200 ] || return 8
            printf '%s' "$API_BODY"
            ;;
        *releases/latest*)
            [ -n "$LATEST_TAG" ] || return 4
            printf '  HTTP/1.1 302 Found\\n  Location: https://github.com/tale-project/tale/releases/tag/%s\\n' "$LATEST_TAG" >&2
            return 8
            ;;
        *) return 1 ;;
    esac
}
DOWNLOADER=${downloader}
ASSET_NAME=tale_linux
get_latest_tag`;
  const apiError = (message: string, status: string) =>
    JSON.stringify(
      { message, documentation_url: 'https://docs.github.com/rest', status },
      null,
      2,
    );

  for (const scenario of [
    { downloader: 'curl', status: '401', message: 'Bad credentials' },
    { downloader: 'curl', status: '404', message: 'Not Found' },
    { downloader: 'curl', status: '500', message: 'Server Error' },
    { downloader: 'wget', status: '401', message: 'Bad credentials' },
  ]) {
    test(`${scenario.downloader}: takes the latest release redirect after an API ${scenario.status}`, () => {
      const result = runBash(releaseLookup(scenario.downloader), {
        API_STATUS: scenario.status,
        API_BODY: apiError(scenario.message, scenario.status),
        LATEST_TAG: 'v9.8.7',
        GITHUB_TOKEN: 'expired-token',
      });
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe('v9.8.7');
    });
  }

  const refusedToken =
    'Failed to fetch releases (HTTP 401). GitHub refused GITHUB_TOKEN, which may be wrong or expired: fix or unset it, then try again.';
  const noAnswer =
    'Failed to fetch releases (network error). Check your connection to GitHub and try again.';
  for (const scenario of [
    {
      name: 'a refused GITHUB_TOKEN',
      downloader: 'curl',
      status: '401',
      token: 'expired-token',
      text: refusedToken,
    },
    {
      name: 'a 401 without a token',
      downloader: 'curl',
      status: '401',
      token: '',
      text: 'Failed to fetch releases (HTTP 401). Try again later.',
    },
    {
      name: 'a 503',
      downloader: 'curl',
      status: '503',
      token: '',
      text: 'Failed to fetch releases (HTTP 503). Try again later.',
    },
    {
      name: 'no answer',
      downloader: 'curl',
      status: '',
      token: '',
      text: noAnswer,
    },
    {
      name: 'a refused GITHUB_TOKEN',
      downloader: 'wget',
      status: '401',
      token: 'expired-token',
      text: refusedToken,
    },
    {
      name: 'no answer',
      downloader: 'wget',
      status: '',
      token: '',
      text: noAnswer,
    },
  ]) {
    test(`${scenario.downloader}: names ${scenario.name} when the redirect fails too`, () => {
      const result = runBash(releaseLookup(scenario.downloader), {
        API_STATUS: scenario.status,
        API_BODY: scenario.status
          ? apiError('Bad credentials', scenario.status)
          : '',
        LATEST_TAG: '',
        GITHUB_TOKEN: scenario.token,
      });
      expect(result.exitCode, result.output).toBe(1);
      expect(result.output).toContain(scenario.text);
      expect(result.output).not.toContain('No release found');
    });
  }

  for (const downloader of ['curl', 'wget']) {
    test(`${downloader}: takes the newest release that carries the asset from a release list`, () => {
      const result = runBash(releaseLookup(downloader), {
        API_STATUS: '200',
        API_BODY: JSON.stringify(
          [
            { tag_name: 'v9.9.0', assets: [{ name: 'tale_linux_arm64' }] },
            { tag_name: 'v9.8.7', assets: [{ name: 'tale_linux' }] },
          ],
          null,
          2,
        ),
        LATEST_TAG: 'v9.9.0',
        GITHUB_TOKEN: '',
      });
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe('v9.8.7');
    });
  }

  test('reports a missing release only for a release list without the asset', () => {
    const result = runBash(releaseLookup('curl'), {
      API_STATUS: '200',
      API_BODY: JSON.stringify(
        [{ tag_name: 'v9.9.0', assets: [{ name: 'tale_linux_arm64' }] }],
        null,
        2,
      ),
      LATEST_TAG: 'v9.9.0',
      GITHUB_TOKEN: '',
    });
    expect(result.exitCode, result.output).toBe(1);
    expect(result.output).toContain('No release found with tale_linux binary');
  });
});

const powershell =
  process.platform === 'win32' ? 'powershell' : Bun.which('pwsh');
const powershellSource = (
  await readFile(join(repository, 'scripts/install-cli.ps1'), 'utf8')
)
  .replace(/\r\n/g, '\n')
  .replace(/\nMain\s*$/, '\n');

function runPowerShell(code: string, environment: Record<string, string> = {}) {
  return runPowerShellScript(`${powershellSource}\n${code}`, environment);
}

async function runPowerShellScript(
  script: string,
  environment: Record<string, string> = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'tale-installer-powershell-'));
  roots.push(root);
  const file = join(root, 'installer-test.ps1');
  // Keep the installer out of Windows' command-line length limit. Windows
  // PowerShell 5 needs a BOM to recognize the script's UTF-8 characters.
  await writeFile(file, `\uFEFF${script}`, 'utf8');
  const run = Bun.spawnSync(
    [
      powershell!,
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      file,
    ],
    {
      env: { ...process.env, ...environment },
      // A fresh pwsh process can spend over 10 seconds starting on hosted runners;
      // 30 seconds covers that cold start while still bounding each installer test.
      timeout: 30_000,
    },
  );
  return { exitCode: run.exitCode, output: `${run.stdout}${run.stderr}` };
}

describe.skipIf(!powershell)('PowerShell CLI installer', () => {
  test('resolves relative install directories from the current PowerShell location', async () => {
    const setup = await fixture();
    const result = await runPowerShell(
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
    test(`prepends the install directory with ${scenario.name}`, async () => {
      const result = await runPowerShell(
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
      const result = await runPowerShell(
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

  // GitHub's release API fails with $env:API_STATUS (no status: no answer at
  // all); the releases/latest redirect points to $env:LATEST_TAG (no tag: the
  // redirect fails too).
  const releaseLookup = `
class ApiFailure : System.Exception {
    [object] $Response
    ApiFailure([int] $status) : base("HTTP $status") {
        $this.Response = [pscustomobject]@{ StatusCode = $status }
    }
}
function Invoke-RestMethod {
    if (-not $env:API_STATUS) { throw [System.Exception]::new('No such host is known.') }
    throw [ApiFailure]::new([int]$env:API_STATUS)
}
function Get-LatestTagFromRedirect {
    if ($env:LATEST_TAG) { return $env:LATEST_TAG }
    return $null
}
Get-LatestTag
`;

  for (const status of ['401', '404', '500']) {
    test(`takes the latest release redirect after an API ${status}`, async () => {
      const result = await runPowerShell(releaseLookup, {
        API_STATUS: status,
        LATEST_TAG: 'v9.8.7',
        GITHUB_TOKEN: 'expired-token',
      });
      expect(result.exitCode, result.output).toBe(0);
      expect(result.output.trim()).toBe('v9.8.7');
    });
  }

  for (const scenario of [
    {
      name: 'a refused GITHUB_TOKEN',
      status: '401',
      token: 'expired-token',
      text: 'Failed to fetch releases (HTTP 401). GitHub refused GITHUB_TOKEN, which may be wrong or expired: fix or unset it, then try again.',
    },
    {
      name: 'a 503',
      status: '503',
      token: '',
      text: 'Failed to fetch releases (HTTP 503). Try again later.',
    },
    {
      name: 'no answer',
      status: '',
      token: '',
      text: 'Failed to fetch releases (network error). Check your connection to GitHub and try again.',
    },
  ]) {
    test(`names ${scenario.name} when the redirect fails too`, async () => {
      const result = await runPowerShell(releaseLookup, {
        API_STATUS: scenario.status,
        LATEST_TAG: '',
        GITHUB_TOKEN: scenario.token,
      });
      expect(result.exitCode, result.output).toBe(1);
      expect(result.output).toContain(`Error: ${scenario.text}`);
      expect(result.output).not.toContain('No release found');
    });
  }

  test('hands an installer error back to the session that runs it through irm | iex', async () => {
    const setup = await fixture();
    const result = await runPowerShellScript(
      `
$ErrorActionPreference = 'Continue'
# The releases carry no Windows binary: an error the installer reports.
function Invoke-RestMethod {
    Write-Host "Release lookup ran with ErrorActionPreference=$ErrorActionPreference"
    return [pscustomobject]@{ tag_name = 'v9.8.7'; assets = @([pscustomobject]@{ name = 'tale_linux' }) }
}
# irm hands iex the installer as one string; read the same text from disk.
# A prompt survives a thrown error but not an exit, and so does this try:
# catch takes a throw, never an exit.
try {
    [System.IO.File]::ReadAllText($env:INSTALLER) | Invoke-Expression
    Write-Output 'Installer returned'
} catch {
    Write-Output "Installer failed: $($_.Exception.Message)"
}
Write-Output "Session still running with ErrorActionPreference=$ErrorActionPreference"
`,
      {
        INSTALLER: join(repository, 'scripts/install-cli.ps1'),
        INSTALL_DIR: setup.installDir,
        VERSION: '',
      },
    );
    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).toContain(
      'Release lookup ran with ErrorActionPreference=Stop',
    );
    expect(result.output).toContain(
      'Error: No release found with tale_windows.exe binary',
    );
    expect(result.output).toContain(
      'Installer failed: No release found with tale_windows.exe binary',
    );
    expect(result.output).not.toContain('Installer returned');
    expect(result.output).toContain(
      'Session still running with ErrorActionPreference=Continue',
    );
  });
});
