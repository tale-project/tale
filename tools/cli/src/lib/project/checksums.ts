import { join } from 'node:path';

import { isChecksums, type Checksums } from './types';

const CHECKSUMS_PATH = '.tale/checksums.json';

export function computeContentHash(content: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(content);
  return `sha256:${hasher.digest('hex')}`;
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await Bun.file(filePath).text();
  return computeContentHash(content);
}

export async function readChecksums(
  projectDir: string,
): Promise<Checksums | null> {
  const filePath = join(projectDir, CHECKSUMS_PATH);
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return null;
  }

  const content = await file.json();
  if (!isChecksums(content)) {
    return null;
  }

  return content;
}

export async function writeChecksums(
  projectDir: string,
  checksums: Checksums,
): Promise<void> {
  const filePath = join(projectDir, CHECKSUMS_PATH);
  await Bun.write(filePath, JSON.stringify(checksums, null, 2) + '\n');
}
