import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { claudeCodeAdapter } from './claude-code.ts';
import { codexAdapter } from './codex.ts';
import { opencodeAdapter } from './opencode.ts';
import type { AdapterDetection, RuntimeAdapter } from './types.ts';

const execFileAsync = promisify(execFile);

export const ADAPTERS: RuntimeAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  opencodeAdapter,
];

export function getAdapter(adapterType: string): RuntimeAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.adapterType === adapterType);
}

/**
 * Probe each known CLI with `--version`; only installed ones are advertised
 * to the server. Versions flow into the registry so feature drift can be
 * gated server-side.
 */
export async function detectAdapters(): Promise<AdapterDetection[]> {
  const detections: AdapterDetection[] = [];
  for (const adapter of ADAPTERS) {
    try {
      const { stdout } = await execFileAsync(adapter.binary, ['--version'], {
        timeout: 10_000,
      });
      const version = stdout.trim().split('\n')[0]?.slice(0, 64);
      detections.push({
        adapterType: adapter.adapterType,
        version,
        capabilities: adapter.capabilities,
      });
    } catch {
      // CLI not installed (or not on PATH) — simply not advertised.
      continue;
    }
  }
  return detections;
}
