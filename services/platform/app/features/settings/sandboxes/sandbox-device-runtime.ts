import type {
  SandboxDeviceHarness,
  SandboxDevicePlatform,
} from '@/lib/shared/schemas/sandbox-devices';

/** The harness slugs a device reports, with the names the product shows
 * (the `displayName` of each `configs/platform/system/harnesses/*` fact
 * file). A Map, so an id such as `constructor` never finds a prototype. */
const HARNESS_NAMES = new Map<string, string>([
  ['claude-code', 'Claude Code'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
  ['gemini', 'Gemini CLI'],
  ['hermes', 'Hermes'],
  ['openclaw', 'OpenClaw'],
  ['opencode', 'OpenCode'],
  ['pi', 'Pi'],
  ['qwen-code', 'Qwen Code'],
]);

/** A harness id outside the map reads as its own slug. */
export function harnessDisplayName(id: string): string {
  return HARNESS_NAMES.get(id) ?? id;
}

/** `Claude Code 2.1.285, Codex 0.160.0` — a version the harness printed
 * follows its name; one it printed none for shows the name alone. */
export function harnessList(harnesses: SandboxDeviceHarness[]): string {
  return harnesses
    .map((h) =>
      h.version === null
        ? harnessDisplayName(h.id)
        : `${harnessDisplayName(h.id)} ${h.version}`,
    )
    .join(', ');
}

/** Where a device runs its sandboxes. A device older than raw devices
 * reports no `runtime`, and it runs Docker. */
export function deviceRuntime(
  platform: SandboxDevicePlatform,
): 'docker' | 'raw' {
  return platform.runtime ?? 'docker';
}

/** The Docker Engine a device reports, for the engine-floor check. A raw
 * device runs no Docker, so it names none. */
export function dockerEngineOf(
  platform: SandboxDevicePlatform | null,
): string | null {
  if (platform === null || deviceRuntime(platform) === 'raw') return null;
  return platform.dockerVersion ?? null;
}
