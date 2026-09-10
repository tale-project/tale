import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { deployRelease, verifyRelease, type DeployOptions } from './deploy';
import { buildRelease } from './release';
import { commandFixture } from './tests/command-fixture';
import { released, temporary } from './tests/fixture';
import { historicalFixture } from './tests/legacy-fixture';
import { nativeServer, receiptBytes } from './tests/native-fixture';

async function fixture(skills = ['invoice'], external = ['pdf']) {
  const f = await released('acme', skills, external);
  const options: DeployOptions = {
    descriptorPath: f.descriptorPath,
    automationName: f.name,
    manifestPath: f.manifestPath,
    url: 'http://127.0.0.1:3005',
    origin: 'https://native.example',
    orgId: 'org-acme',
    projectId: 'existing-project',
    cookie: 'session=synthetic-private-test',
    receiptPath: path.join(f.root, 'receipt.json'),
  };
  return { ...f, options, state: await nativeServer(f.release, options) };
}

test('two owned skills install create-only, a workflow-only transport imports, and repeated native bytes prove idempotence', async () => {
  const { options, state } = await fixture(['invoice', 'invoice-tools']);
  const first = await deployRelease(options);
  expect(first.unchanged).toBe(false);
  expect(first.automationVersion).toBe(7);
  expect(state.skillCreates).toBe(2);
  expect(state.imports).toBe(1);
  expect(state.deploys).toBe(1);
  expect(receiptBytes(options).toString()).not.toContain(options.cookie);
  expect(receiptBytes(options).toString()).not.toContain('skill-1');
  const before = state.requests.length;
  expect((await deployRelease(options)).unchanged).toBe(true);
  expect(state.imports).toBe(1);
  expect(state.deploys).toBe(1);
  expect(
    state.requests.slice(before).every((entry) => entry.method === 'GET'),
  ).toBe(true);
  const receipt = receiptBytes(options);
  expect(
    (await verifyRelease({ ...options, receiptPath: undefined }))
      .skillFilesVerified,
  ).toBe(4);
  expect(receiptBytes(options)).toEqual(receipt);
  state.deployed = 3;
  expect(
    (
      await verifyRelease({
        ...options,
        automationVersion: 7,
        requireDeployed: false,
      })
    ).verified,
  ).toBe(true);
  await expect(verifyRelease(options)).rejects.toThrow('did not converge');
  await deployRelease(options);
  expect(state.deploys).toBe(2);
});

test('pure workflow client needs neither owned skills nor native uploader identity', async () => {
  const { options, state } = await fixture([], []);
  expect((await deployRelease(options)).automationVersion).toBe(7);
  expect(state.skillCreates).toBe(0);
  expect(
    state.requests.some(
      (entry) =>
        entry.path.includes('/skills') || entry.path.includes('get-session'),
    ),
  ).toBe(false);
  expect((await verifyRelease(options)).skillFilesVerified).toBe(0);
});

for (const fault of [
  'wrongOwner',
  'conflictDifferent',
  'workflowConflict',
  'wrongName',
  'warnings',
  'missingBinding',
  'skillWrite',
  'driftDuringImport',
  'changedPresentation',
  'failedTests',
  'missingStorage',
  'missingExternal',
  'invalidResponse',
  'httpFailure',
]) {
  test(`native fault ${fault} refuses promotion`, async () => {
    const { options, state } = await fixture();
    state.faults.add(fault);
    await expect(deployRelease(options)).rejects.toThrow();
    expect(state.deploys).toBe(0);
    if (
      [
        'wrongOwner',
        'missingExternal',
        'invalidResponse',
        'httpFailure',
      ].includes(fault)
    )
      expect(state.requests.every((entry) => entry.method === 'GET')).toBe(
        true,
      );
  });
}
for (const fault of ['corruptFile', 'unexpectedFile', 'missingAsset']) {
  test(`existing skill ${fault} refuses before any mutation, including on replay`, async () => {
    const { options, state, release } = await fixture();
    release.manifest.skillSlugs.forEach((slug) => state.installed.add(slug));
    state.faults.add(fault);
    await expect(deployRelease(options)).rejects.toThrow();
    expect(state.requests.every((entry) => entry.method === 'GET')).toBe(true);
    state.faults.clear();
    await deployRelease(options);
    state.faults.add(fault);
    const writes = state.imports;
    await expect(deployRelease(options)).rejects.toThrow();
    expect(state.imports).toBe(writes);
  });
}

test('atomic create conflict with identical bytes is reused and lost creation response resumes', async () => {
  for (const fault of ['conflictSame', 'loseCreation']) {
    const { options, state } = await fixture();
    state.faults.add(fault);
    if (fault === 'loseCreation')
      await expect(deployRelease(options)).rejects.toThrow(
        'response may have been lost',
      );
    await deployRelease(options);
    expect(state.skillCreates).toBe(1);
    expect(state.imports).toBe(1);
  }
});

test('saved import recovers failed deployment; lost unpublished response holds without duplicate version', async () => {
  const { options, state } = await fixture();
  state.faults.add('failDeploy');
  await expect(deployRelease(options)).rejects.toThrow('HTTP 503');
  expect(JSON.parse(receiptBytes(options).toString()).status).toBe('saved');
  state.faults.clear();
  await deployRelease(options);
  expect(state.imports).toBe(1);
  const other = await fixture();
  other.state.faults.add('loseUpload');
  await expect(deployRelease(other.options)).rejects.toThrow(
    'response may have been lost',
  );
  await expect(deployRelease(other.options)).rejects.toThrow(
    'unreceipted unpublished',
  );
  expect(other.state.imports).toBe(1);
  expect(other.state.deploys).toBe(0);
});

test('lost receipt recovers exact deployed bytes, but never accepts task-contract drift', async () => {
  const { options, state } = await fixture();
  await deployRelease(options);
  unlinkSync(options.receiptPath!);
  expect((await deployRelease(options)).unchanged).toBe(true);
  expect(state.imports).toBe(1);
  for (const remove of [false, true]) {
    if (remove) unlinkSync(options.receiptPath!);
    state.faults.add('wrongTask');
    const before = state.requests.length;
    await expect(deployRelease(options)).rejects.toThrow(
      'task contract differs',
    );
    expect(
      state.requests.slice(before).every((entry) => entry.method === 'GET'),
    ).toBe(true);
  }
});

test('credential/target injection and modified companion ZIPs refuse before requests', async () => {
  const { options, state, release } = await fixture();
  for (const changed of [
    { url: 'http://remote.example' },
    { url: 'https://user:pass@remote.example' },
    { origin: 'https://example.com/path' },
    { cookie: 'private\nheader: injected' },
    { orgId: '' },
    { projectId: '' },
    { receiptPath: undefined },
    { automationVersion: -1 },
  ])
    await expect(deployRelease({ ...options, ...changed })).rejects.toThrow();
  expect(state.requests).toHaveLength(0);
  for (const artifact of [
    release,
    release.installation!.workflow,
    ...release.installation!.skills,
  ]) {
    writeFileSync(artifact.artifactPath, 'changed');
    await expect(deployRelease(options)).rejects.toThrow('checksum');
    writeFileSync(artifact.artifactPath, artifact.bytes);
  }
  expect(state.requests).toHaveLength(0);
});

test('bad receipt and stale temporary files are not permanent locks', async () => {
  const { options, state } = await fixture();
  writeFileSync(options.receiptPath!, 'corrupt');
  await expect(deployRelease(options)).rejects.toThrow('receipt is unreadable');
  expect(state.deploys).toBe(0);
  expect(state.skillCreates).toBe(0);
  expect(state.uploads).toBe(0);
  const url = new URL('/unsupported', options.url);
  url.searchParams.set('orgId', options.orgId);
  await expect(
    options.fetchImpl!(url, {
      method: 'GET',
      redirect: 'error',
      headers: { cookie: options.cookie, origin: options.origin! },
    }),
  ).rejects.toThrow('unexpected request');
  unlinkSync(options.receiptPath!);
  writeFileSync(options.receiptPath + '.lock', 'old crash');
  writeFileSync(options.receiptPath + '.tmp.123', 'old write');
  await deployRelease(options);
  expect(readFileSync(options.receiptPath + '.lock', 'utf8')).toBe('old crash');
  expect(readFileSync(options.receiptPath + '.tmp.123', 'utf8')).toBe(
    'old write',
  );
});

test('frozen legacy only reuses a proven retained version, never uploads', async () => {
  const { descriptorPath, manifestPath, name, release } =
    await historicalFixture();
  const options: DeployOptions = {
    descriptorPath,
    manifestPath,
    automationName: name,
    url: 'http://localhost:3005',
    origin: 'https://native.example',
    orgId: 'org-vat',
    projectId: 'bootstrap',
    cookie: 'session=synthetic',
    receiptPath: path.join(temporary(), 'receipt.json'),
  };
  const state = await nativeServer(release, options);
  release.manifest.skillSlugs.forEach((slug) => state.installed.add(slug));
  state.exists = true;
  state.deployed = 9;
  writeFileSync(
    options.receiptPath!,
    JSON.stringify({
      schemaVersion: 1,
      target: {
        origin: options.origin,
        orgId: options.orgId,
        projectId: options.projectId,
        automationName: options.automationName,
      },
      configVersion: '1.0.4',
      artifactSha256: 'x',
      automationVersion: 9,
      previous: {
        configVersion: '1.0.3',
        artifactSha256: release.manifest.artifact.sha256,
        automationVersion: 7,
      },
    }),
  );
  await deployRelease(options);
  expect(state.deploys).toBe(1);
  expect(state.imports).toBe(0);
  expect(state.skillCreates).toBe(0);
  expect(
    (await verifyRelease({ ...options, automationVersion: 7 })).verified,
  ).toBe(true);
  state.faults.add('wrongWorkflow');
  unlinkSync(options.receiptPath!);
  await expect(deployRelease(options)).rejects.toThrow('uploads are forbidden');
  const frozen = await historicalFixture(1, false);
  await expect(
    deployRelease({
      ...options,
      descriptorPath: frozen.descriptorPath,
      manifestPath: frozen.manifestPath,
    }),
  ).rejects.toThrow('frozen');
  const readOptions = {
    ...options,
    descriptorPath: frozen.descriptorPath,
    manifestPath: frozen.manifestPath,
    automationVersion: 7,
    requireDeployed: false,
  };
  const readonlyState = await nativeServer(frozen.release, readOptions);
  frozen.release.manifest.skillSlugs.forEach((slug) =>
    readonlyState.installed.add(slug),
  );
  readonlyState.exists = true;
  readonlyState.deployed = 7;
  expect((await verifyRelease(readOptions)).verified).toBe(true);
  expect(
    readonlyState.requests.every((request) => request.method === 'GET'),
  ).toBe(true);
});

test('native transport, JSON and cancellation failures never expose raw causes', async () => {
  const f = await fixture();
  const secret = 'synthetic-credential-must-not-leak';
  const failing = [
    async () => {
      throw new Error(secret);
    },
    async () =>
      new Response(secret, { headers: { 'content-type': 'application/json' } }),
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            throw new Error(secret);
          },
        }),
        { status: 503 },
      ),
  ];
  for (const fetchImpl of failing) {
    let caught: unknown;
    try {
      await verifyRelease({ ...f.options, fetchImpl });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain('Tale');
    expect(String(caught)).not.toContain(secret);
    expect((caught as Error).cause).toBeUndefined();
  }
});

test('SHA receipts recover a saved deployment and preserve a previous semantic identity', async () => {
  const f = commandFixture();
  const output = temporary();
  const release = await buildRelease({
    ...f.options,
    version: undefined,
    output,
  });
  const options: DeployOptions = {
    descriptorPath: f.descriptorPath,
    automationName: f.name,
    manifestPath: path.join(output, `${f.options.sourceCommit}.json`),
    url: 'http://127.0.0.1',
    origin: 'https://native.example',
    orgId: 'org-acme',
    projectId: 'bootstrap',
    cookie: 'session=synthetic-sha',
    receiptPath: path.join(temporary(), 'receipt.json'),
  };
  const state = await nativeServer(release, options);
  writeFileSync(
    options.receiptPath!,
    JSON.stringify({
      schemaVersion: 1,
      target: {
        origin: options.origin,
        orgId: options.orgId,
        projectId: options.projectId,
        automationName: f.name,
      },
      configVersion: '1.0.4',
      artifactSha256: 'a'.repeat(64),
      automationVersion: 6,
    }),
  );
  state.faults.add('failDeploy');
  await expect(deployRelease(options)).rejects.toThrow('HTTP 503');
  const saved = JSON.parse(receiptBytes(options).toString());
  expect(saved.schemaVersion).toBe(2);
  expect(saved.releaseRef).toBe(f.options.sourceCommit);
  expect(saved.sourceCommit).toBe(f.options.sourceCommit);
  expect(saved.configVersion).toBeUndefined();
  expect(saved.status).toBe('saved');
  expect(saved.previous).toEqual({
    configVersion: '1.0.4',
    artifactSha256: 'a'.repeat(64),
    automationVersion: 6,
  });
  state.faults.clear();
  expect((await deployRelease(options)).releaseRef).toBe(
    f.options.sourceCommit,
  );
  expect((await deployRelease(options)).unchanged).toBe(true);
  expect(state.imports).toBe(1);
  expect(state.deploys).toBe(1);
  const before = state.requests.length;
  writeFileSync(
    options.receiptPath!,
    JSON.stringify({ ...saved, sourceCommit: 'f'.repeat(40) }),
  );
  await expect(deployRelease(options)).rejects.toThrow('receipt is unreadable');
  expect(
    state.requests.slice(before).every((request) => request.method === 'GET'),
  ).toBe(true);
  unlinkSync(options.receiptPath!);
  expect((await deployRelease(options)).unchanged).toBe(true);
  expect(state.imports).toBe(1);
  state.faults.add('corruptFile');
  const beforeDrift = state.requests.length;
  await expect(deployRelease(options)).rejects.toThrow();
  expect(
    state.requests
      .slice(beforeDrift)
      .every((request) => request.method === 'GET'),
  ).toBe(true);
});
