import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

type Component = {
  name: string;
  version: string;
  purl: string;
  'bom-ref': string;
  hashes?: { alg: string; content: string }[];
};
type SBOM = {
  bomFormat: string;
  components: Component[];
  vulnerabilities?: unknown[];
};
type JSONReport = {
  Results: {
    Packages?: { Name: string; Version: string; Digest?: string }[];
    Vulnerabilities?: unknown[];
  }[];
};

const trivy = Bun.which('trivy');
assert(
  trivy,
  'The installed Trivy 0.70.0 binary is required; no download fallback.',
);

const directory = await mkdtemp(join(tmpdir(), 'tale-sbom-hashes-'));
const config = join(directory, 'trivy.yaml');
await writeFile(config, '{}\n');
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('TRIVY_')),
);
Object.assign(env, {
  // Native memory analysis plus disjoint directories avoids persistent entries
  // produced without file checksums. All fixtures run without CVE/Java downloads.
  TRIVY_CACHE_BACKEND: 'memory',
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: '',
});

const commands: { argv: string[]; exit: number }[] = [];
async function run(label: string, args: string[]): Promise<string> {
  const cache = join(directory, `${label}-cache`);
  await mkdir(cache);
  const argv = [trivy!, ...args, '--config', config, '--cache-dir', cache];
  const child = Bun.spawn(argv, {
    cwd: directory,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 45_000,
  });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  commands.push({ argv, exit });
  await writeFile(join(directory, `${label}.log`), stdout + stderr);
  await writeFile(
    join(directory, 'commands.json'),
    JSON.stringify(commands, null, 2) + '\n',
  );
  assert.equal(
    exit,
    0,
    `${label} failed; reports in ${directory}\n${stdout}${stderr}`,
  );
  return stdout;
}

const version = await run('version', ['--version']);
assert(
  version.split(/\r?\n/).includes('Version: 0.70.0'),
  `Expected Trivy 0.70.0; received ${version.trim()}`,
);

const fixtures = [
  {
    name: 'tale-hash-node-proof',
    version: '1.2.3',
    purl: 'pkg:npm/tale-hash-node-proof@1.2.3',
    expectedSHA1: '0dbb382c05ac3d1c1aa1271678734b92c9999606',
    file: 'node_modules/tale-hash-node-proof/package.json',
    contents:
      JSON.stringify(
        { name: 'tale-hash-node-proof', version: '1.2.3', license: 'MIT' },
        null,
        2,
      ) + '\n',
  },
  {
    name: 'tale-hash-python-proof',
    version: '2.3.4',
    purl: 'pkg:pypi/tale-hash-python-proof@2.3.4',
    expectedSHA1: '07b960a55b2f23b8b6559978c5e3f3a84b5dd5f5',
    file: 'usr/local/lib/python3.12/site-packages/tale_hash_python_proof-2.3.4.dist-info/METADATA',
    contents:
      'Metadata-Version: 2.1\nName: tale-hash-python-proof\nVersion: 2.3.4\nLicense: MIT\n\n',
  },
];

for (const fixture of fixtures) {
  const root = join(directory, fixture.name);
  const file = join(root, fixture.file);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, fixture.contents);
  await writeFile(
    join(directory, `${fixture.name}-fixture.json`),
    JSON.stringify(
      {
        ...fixture,
        sha256: createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  const direct = join(directory, `${fixture.name}-direct.cdx.json`);
  const json = join(directory, `${fixture.name}.json`);
  const converted = join(directory, `${fixture.name}-converted.cdx.json`);
  const offline = [
    '--skip-db-update',
    '--skip-java-db-update',
    '--skip-version-check',
    '--offline-scan',
    '--disable-telemetry',
    '--no-progress',
    '--timeout',
    '30s',
  ];
  // rootfs retains the installed-package analyzers used by image scanning.
  // fs disables those analyzers and would not exercise these package classes.
  await run(`${fixture.name}-direct`, [
    'rootfs',
    ...offline,
    '--format',
    'cyclonedx',
    '--output',
    direct,
    root,
  ]);
  await run(`${fixture.name}-json`, [
    'rootfs',
    ...offline,
    '--scanners',
    'license',
    '--list-all-pkgs',
    '--format',
    'json',
    '--output',
    json,
    root,
  ]);
  await run(`${fixture.name}-convert`, [
    'convert',
    '--format',
    'cyclonedx',
    '--severity',
    '',
    '--output',
    converted,
    json,
  ]);

  const directReport = (await Bun.file(direct).json()) as SBOM;
  const convertedReport = (await Bun.file(converted).json()) as SBOM;
  const jsonReport = (await Bun.file(json).json()) as JSONReport;
  for (const report of [directReport, convertedReport]) {
    assert.equal(report.bomFormat, 'CycloneDX');
    assert(Array.isArray(report.components));
    assert.equal(report.components.length, 1);
    assert.deepEqual(report.vulnerabilities ?? [], []);
    const component = report.components[0]!;
    assert.equal(component.name, fixture.name);
    assert.equal(component.version, fixture.version);
    assert.equal(component.purl, fixture.purl);
  }
  assert(Array.isArray(jsonReport.Results));
  const packages = jsonReport.Results.flatMap((result) => {
    assert.deepEqual(result.Vulnerabilities ?? [], []);
    return result.Packages ?? [];
  });
  assert.equal(packages.length, 1);
  assert.equal(packages[0]!.Name, fixture.name);
  assert.equal(packages[0]!.Version, fixture.version);
  assert.equal(packages[0]!.Digest ?? '', '');

  const actual = directReport.components[0]!;
  assert.deepEqual(actual.hashes, [
    {
      alg: 'SHA-1',
      content: fixture.expectedSHA1,
    },
  ]);
  const negative = convertedReport.components[0]!;
  assert.deepEqual(negative.hashes ?? [], []);
  const metadata = (component: Component) => {
    const { 'bom-ref': _ref, hashes: _hashes, ...rest } = component;
    return rest;
  };
  assert.deepEqual(metadata(actual), metadata(negative));
}

console.log(
  `check-sbom-hashes: Node/Python inventory and hashes verified; reports in ${directory}`,
);
