import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { DeploymentColor } from '../compose/types';
import { getFlipPendingFilePath } from './get-flip-pending-file-path';

export interface FlipPending {
  promoting: DeploymentColor;
  retiring: DeploymentColor | null;
}

function isColor(value: unknown): value is DeploymentColor {
  return value === 'blue' || value === 'green';
}

export async function getFlipPending(
  deployDir: string,
): Promise<FlipPending | null> {
  try {
    const parsed: unknown = JSON.parse(
      await Bun.file(getFlipPendingFilePath(deployDir)).text(),
    );
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (!isColor(o.promoting)) return null;
    if (o.retiring !== null && !isColor(o.retiring)) return null;
    return {
      promoting: o.promoting,
      retiring: o.retiring,
    };
  } catch {
    return null;
  }
}

export async function setFlipPending(
  deployDir: string,
  pending: FlipPending,
): Promise<void> {
  const path = getFlipPendingFilePath(deployDir);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(pending));
}

export async function clearFlipPending(deployDir: string): Promise<void> {
  try {
    await unlink(getFlipPendingFilePath(deployDir));
  } catch {
    // Already gone.
  }
}
