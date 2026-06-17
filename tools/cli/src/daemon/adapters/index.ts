import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { opencodeAdapter } from './opencode';
import { isRecord, type AdapterDetection, type RuntimeAdapter } from './types';

const execFileAsync = promisify(execFile);

/** `execFile` reports a missing binary as a Node error with code 'ENOENT'. */
function isEnoent(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

const ADAPTERS: RuntimeAdapter[] = [
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
    } catch (error) {
      // ENOENT just means the CLI isn't installed / not on PATH — the
      // expected quiet path, simply don't advertise it. Anything else
      // (e.g. a hung probe, permission error) is unexpected: warn so a
      // misconfigured CLI doesn't silently disappear from the registry.
      if (!isEnoent(error)) {
        console.warn(
          `[tale-daemon] probing ${adapter.binary} --version failed:`,
          error,
        );
      }
      continue;
    }
  }
  return detections;
}
