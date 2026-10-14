import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLab, parseLab } from './lab-config.ts';

/** What lab.sh `lab-file` writes. */
const LAB = {
  stateDir: '/mnt/tale-incus-e2e',
  endpoint: 'https://127.0.0.1:8443',
  project: 'sandbox-pr',
  profile: 'sandbox',
  network: 'sbx0',
  pool: 'tank',
  acl: 'sandbox-egress',
  image: 'tale-sandbox-runtime',
  imageSource: '127.0.0.1:5000/tale-sandbox-runtime:e2e',
  imageSourceNext: '127.0.0.1:5000/tale-sandbox-runtime:e2e-next',
  clientCertFile: '/mnt/tale-incus-e2e/pki/client.crt',
  clientKeyFile: '/mnt/tale-incus-e2e/pki/client.key',
  serverCertFile: '/mnt/tale-incus-e2e/pki/server.crt',
  defaultServerCertFile: '/mnt/tale-incus-e2e/pki/incus-default-server.crt',
  otherServerCertFile: '/mnt/tale-incus-e2e/pki/other-server.crt',
  egressProxy: 'http://10.20.0.2:3128',
  bridgeAddress: '10.20.0.1',
  egressAddress: '10.20.0.2',
  gatewayAddress: '10.20.0.3',
  backendAddress: '10.20.0.4',
  egressInstance: 'egress',
  egressImage: 'tale-sandbox-egress',
};

describe('parseLab', () => {
  test('reads what lab.sh writes', () => {
    expect(parseLab(LAB)).toEqual(LAB);
  });

  test('names the field that is missing or empty', () => {
    const { pool: _pool, ...without } = LAB;
    expect(() => parseLab(without)).toThrow('the lab file has no pool');
    expect(() => parseLab({ ...LAB, endpoint: '' })).toThrow(
      'the lab file has no endpoint',
    );
    expect(() => parseLab({ ...LAB, project: 3 })).toThrow(
      'the lab file has no project',
    );
  });

  test('refuses what is not an object', () => {
    expect(() => parseLab(null)).toThrow('not a JSON object');
    expect(() => parseLab([LAB])).toThrow('not a JSON object');
  });
});

describe('loadLab', () => {
  test('reads the file the path names, and says what to do without one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'incus-e2e-lab-'));
    const file = join(dir, 'lab.json');
    writeFileSync(file, JSON.stringify(LAB));
    expect(loadLab(file).network).toBe('sbx0');
    expect(() => loadLab(undefined)).toThrow('INCUS_E2E_LAB');
    expect(() => loadLab('')).toThrow('INCUS_E2E_LAB');
  });
});
