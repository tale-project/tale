import { lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { sha256, stableJson } from '../config/releases/identity';
import {
  clientConsumerSchema,
  clientExportReceiptSchema,
  consumerEnvironment,
  type ClientConsumer,
  type ClientExportResult,
  type ClientExportTarget,
} from './client-export-model';
import {
  readProvisionStateProof,
  writeProvisionState,
} from './provision-state';

const bytes = (value: unknown) =>
  Buffer.from(JSON.stringify(value, null, 2) + '\n');
/** The immediate parent is an existing private trust root. Output never follows
 * symlinks or accepts an unowned/writable ancestor within that selected parent. */
export function validateClientExportDirectory(directory: string): boolean {
  if (
    !isAbsolute(directory) ||
    resolve(directory) !== directory ||
    /[\x00-\x1f\x7f]/.test(directory) ||
    directory.length > 4096
  )
    throw preconditionError(
      'Credential output must be an absolute canonical path.',
    );
  const parent = dirname(directory);
  const info = lstatSync(parent);
  const canonical = realpathSync(parent);
  // These two Darwin aliases are installed by the OS. Require their exact
  // canonical mapping; custom symlink components still change the suffix and
  // refuse, as do all unsafe owners and permissions below.
  const systemAlias =
    process.platform === 'darwin' &&
    (parent.startsWith('/var/') || parent.startsWith('/tmp/')) &&
    canonical === '/private' + parent;
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    (canonical !== parent && !systemAlias)
  )
    throw preconditionError(
      'Credential output requires an existing private account-owned parent without symlinks.',
    );
  // An owned private leaf is not a trust root if another account can rename
  // it through a writable ancestor. Root-owned sticky system temp directories
  // are safe for an account-owned child and remain supported.
  for (let ancestor = dirname(canonical); ; ancestor = dirname(ancestor)) {
    const owner = lstatSync(ancestor);
    if (
      !owner.isDirectory() ||
      owner.isSymbolicLink() ||
      (owner.uid !== 0 && owner.uid !== process.getuid?.()) ||
      ((owner.mode & 0o022) !== 0 && (owner.mode & 0o1000) === 0)
    )
      throw preconditionError(
        'Credential output has an untrusted or writable ancestor.',
      );
    if (dirname(ancestor) === ancestor) break;
  }
  try {
    const found = lstatSync(directory);
    if (
      !found.isDirectory() ||
      found.isSymbolicLink() ||
      found.uid !== process.getuid?.() ||
      (found.mode & 0o077) !== 0
    )
      throw preconditionError(
        'Credential output directory is not private and account-owned.',
      );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function artifacts(value: ClientConsumer, target: ClientExportTarget) {
  const selected = clientConsumerSchema.parse(value);
  const entries: {
    path: 'client.json' | 'consumer-env.json';
    value: unknown;
  }[] = [{ path: 'client.json', value: selected }];
  if (target.envPrefix)
    entries.push({
      path: 'consumer-env.json',
      value: consumerEnvironment(selected, target.envPrefix),
    });
  return entries;
}
export function verifyClientExportDirectory(
  directory: string,
  target: ClientExportTarget,
): { result: ClientExportResult; consumer: ClientConsumer } {
  if (!validateClientExportDirectory(directory))
    throw preconditionError('Completed credential export is missing.');
  const receipt = readProvisionStateProof(
    join(directory, 'receipt.json'),
    clientExportReceiptSchema,
  );
  const consumer = readProvisionStateProof(
    join(directory, 'client.json'),
    clientConsumerSchema,
  );
  if (
    !receipt ||
    !consumer ||
    stableJson(receipt.value.target) !== stableJson(target)
  )
    throw preconditionError(
      'Credential export is incomplete or belongs to another ready deployment.',
    );
  const value = consumer.value;
  if (
    stableJson(value.deployment) !== stableJson(target.deployment) ||
    value.issuer !== `${target.origin}/api/auth` ||
    value.organizationId !== target.organization.id ||
    value.organizationSlug !== target.organization.slug ||
    value.clientKey !== target.client.key ||
    value.clientId !== target.client.clientId ||
    stableJson(value.redirectUris) !== stableJson(target.client.redirectUris)
  )
    throw preconditionError(
      'Credential consumer identity differs from its export proof.',
    );
  const expected = artifacts(value, target);
  if (
    stableJson(readdirSync(directory).sort()) !==
    stableJson([...expected.map((e) => e.path), 'receipt.json'].sort())
  )
    throw preconditionError(
      'Credential export has an incomplete or unexpected file inventory.',
    );
  const files = expected.map((entry) => ({
    path: entry.path,
    sha256: sha256(bytes(entry.value)),
    bytes: bytes(entry.value).length,
  }));
  if (
    stableJson(files) !== stableJson(receipt.value.files) ||
    sha256(bytes(receipt.value)) !== receipt.sha256
  )
    throw preconditionError(
      'Credential export metadata or bytes differ from their canonical proof.',
    );
  for (const entry of expected) {
    const proof = readProvisionStateProof(
      join(directory, entry.path),
      z.unknown(),
    );
    if (!proof || proof.sha256 !== sha256(bytes(entry.value)))
      throw preconditionError('Credential export bytes have changed.');
  }
  return {
    consumer: value,
    result: {
      schemaVersion: 1,
      directory,
      unchanged: true,
      receipt: receipt.value,
      receiptFile: {
        path: 'receipt.json',
        sha256: receipt.sha256,
        bytes: bytes(receipt.value).length,
      },
    },
  };
}
/** A partial directory is deliberately retained and refused. Only a complete,
 * byte-identical ready export is a replay; no pending output is promoted. */
export function publishClientExport(
  directory: string,
  target: ClientExportTarget,
  value: ClientConsumer,
): ClientExportResult {
  const entries = artifacts(value, target);
  if (validateClientExportDirectory(directory)) {
    const existing = verifyClientExportDirectory(directory, target);
    if (stableJson(existing.consumer) !== stableJson(value))
      throw preconditionError(
        'Existing credential export contains different credentials or callbacks.',
      );
    return existing.result;
  }
  mkdirSync(directory, { mode: 0o700 });
  for (const entry of entries)
    writeProvisionState(join(directory, entry.path), entry.value, true);
  const receipt = clientExportReceiptSchema.parse({
    schemaVersion: 1,
    kind: 'tale-oidc-client-export',
    phase: 'ready',
    target,
    files: entries.map((entry) => ({
      path: entry.path,
      sha256: sha256(bytes(entry.value)),
      bytes: bytes(entry.value).length,
    })),
  });
  writeProvisionState(join(directory, 'receipt.json'), receipt, true);
  return {
    ...verifyClientExportDirectory(directory, target).result,
    unchanged: false,
  };
}
