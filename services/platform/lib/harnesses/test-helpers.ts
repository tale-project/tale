// Shared helpers for the harness test suites: fixture loading (the captured
// native-CLI stdout streams under `fixtures/<slug>/`), the whole-vs-chunked
// parser drivers, and the golden exec battery — the fixed HarnessRunSpec set
// whose built execs are frozen under `fixtures/exec/<slug>.yml` and prove
// the YAML-driven exec builder reproduces the retired per-slug glue modules
// byte for byte. Every fixture is YAML, read through the shared config loader
// — captured streams store each stdout event as a native YAML mapping under
// an `events:` sequence; the exec goldens store the built-exec structure
// directly. Test-only — never imported by shipped glue code, so the node
// imports here stay out of every runtime bundle.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYamlOrThrow } from '../shared/config/yaml';
import type {
  HarnessEvent,
  HarnessEventParser,
  HarnessExec,
  HarnessRunSpec,
} from './types';

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

/** Narrow parsed YAML to the fixture's `{ events: unknown[] }` shape. */
function hasEvents(value: unknown): value is { events: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'events' in value &&
    Array.isArray(value.events)
  );
}

/**
 * The captured stdout stream `fixtures/<slug>/<name>.yml`, reconstructed as
 * the wire bytes the CLI emitted. The fixture stores each stdout event as a
 * native YAML mapping under an `events:` sequence; each is re-serialized to
 * one compact NDJSON line and the lines joined with `\n`. The parsers consume
 * each line via `JSON.parse`, so this reconstruction reproduces the exact
 * event semantics the CLI streamed. No trailing newline is added — NDJSON has
 * no trailing empty record, and every parser's `end()` flush surfaces the
 * final unterminated line identically.
 */
export function readFixture(slug: string, name: string): string {
  const text = readFileSync(
    path.join(FIXTURES_DIR, slug, `${name}.yml`),
    'utf8',
  );
  const data = parseYamlOrThrow(text);
  if (!hasEvents(data)) {
    throw new Error(
      `fixture ${slug}/${name}.yml must hold an "events" sequence`,
    );
  }
  return data.events.map((event) => JSON.stringify(event)).join('\n');
}

// ---------------------------------------------------------------------------
// Golden exec battery
// ---------------------------------------------------------------------------
// Fixed sentinel inputs, chosen (like the old pairing-probe values) to be
// JSON-inert — no quotes or backslashes — so substring checks against a
// serialized exec cannot be defeated by JSON escaping. The prompt must not
// contain the word "ultrathink" or a `${` sequence: the battery pins the
// prompt-transform and placeholder-substitution defaults, not their
// already-applied edge cases.

export const GOLDEN_GATEWAY = {
  baseUrl: 'http://golden-gw:8080',
  token: 'golden-session-virtual-key',
} as const;

export const GOLDEN_BYO_ENV = {
  GOLDEN_BYO_KEY: 'golden-byo-credential-secret',
} as const;

const GOLDEN_WORKDIR = '/user/workspace';
const GOLDEN_PROMPT = 'Golden battery prompt: fix the flaky login test';
const GOLDEN_INSTRUCTIONS = 'Golden instructions: follow the org runbook.';
const GOLDEN_RESUME = 'golden-resume-handle';
const GOLDEN_DIRS = ['/user/uploads', '/user/shared-data'] as const;
const GOLDEN_BRIDGE_URL = 'http://platform.internal/bridge';
const GOLDEN_EXEC_ID = 'exec-golden-42';
const GOLDEN_VISION_MODEL = 'golden-vision-model';

export interface GoldenCase {
  readonly name: string;
  readonly mode: 'managed' | 'byo';
  readonly spec: HarnessRunSpec;
}

function managedSpec(overrides?: Partial<HarnessRunSpec>): HarnessRunSpec {
  return {
    prompt: GOLDEN_PROMPT,
    credential: { mode: 'managed', gateway: GOLDEN_GATEWAY },
    workdir: GOLDEN_WORKDIR,
    ...overrides,
  };
}

function byoSpec(overrides?: Partial<HarnessRunSpec>): HarnessRunSpec {
  return {
    prompt: GOLDEN_PROMPT,
    credential: { mode: 'byo', env: GOLDEN_BYO_ENV },
    workdir: GOLDEN_WORKDIR,
    ...overrides,
  };
}

/**
 * The full spec battery. One shared list for every harness — cases the
 * harness ignores (posture, dirs, vision, …) golden-pin the IGNORING too —
 * filtered by the harness's credential policy (a cursor managed build or an
 * opencode byo build is outside the shipped policy and not a golden).
 */
export function goldenBattery(): readonly GoldenCase[] {
  return [
    { name: 'managed-baseline', mode: 'managed', spec: managedSpec() },
    {
      name: 'managed-model-opus',
      mode: 'managed',
      spec: managedSpec({ model: 'claude-opus-4-6' }),
    },
    {
      name: 'managed-model-gateway-ref',
      mode: 'managed',
      spec: managedSpec({ model: 'openrouter/anthropic/claude-sonnet-4.6' }),
    },
    {
      name: 'managed-model-default',
      mode: 'managed',
      spec: managedSpec({ model: 'default' }),
    },
    {
      name: 'managed-plan',
      mode: 'managed',
      spec: managedSpec({ posture: 'plan' }),
    },
    {
      name: 'managed-act',
      mode: 'managed',
      spec: managedSpec({ posture: 'act' }),
    },
    {
      name: 'managed-resume',
      mode: 'managed',
      spec: managedSpec({ resume: GOLDEN_RESUME }),
    },
    {
      name: 'managed-instructions',
      mode: 'managed',
      spec: managedSpec({ instructions: GOLDEN_INSTRUCTIONS }),
    },
    {
      name: 'managed-dirs',
      mode: 'managed',
      spec: managedSpec({ additionalDirs: [...GOLDEN_DIRS] }),
    },
    {
      name: 'managed-mcp-headless-bridge',
      mode: 'managed',
      spec: managedSpec({
        mcp: { browser: 'headless', bridgeUrl: GOLDEN_BRIDGE_URL },
      }),
    },
    {
      name: 'managed-mcp-cdp',
      mode: 'managed',
      spec: managedSpec({ mcp: { browser: 'cdp' } }),
    },
    {
      name: 'managed-mcp-bridge-only',
      mode: 'managed',
      spec: managedSpec({ mcp: { bridgeUrl: GOLDEN_BRIDGE_URL } }),
    },
    {
      name: 'managed-vision',
      mode: 'managed',
      spec: managedSpec({
        vision: { model: GOLDEN_VISION_MODEL },
        mcp: { browser: 'headless' },
      }),
    },
    {
      name: 'managed-steer',
      mode: 'managed',
      spec: managedSpec({ execId: GOLDEN_EXEC_ID }),
    },
    {
      name: 'managed-kitchen-sink',
      mode: 'managed',
      spec: managedSpec({
        model: 'claude-opus-4-6',
        resume: GOLDEN_RESUME,
        instructions: GOLDEN_INSTRUCTIONS,
        additionalDirs: [...GOLDEN_DIRS],
        mcp: { browser: 'headless', bridgeUrl: GOLDEN_BRIDGE_URL },
        execId: GOLDEN_EXEC_ID,
        vision: { model: GOLDEN_VISION_MODEL },
      }),
    },
    { name: 'byo-baseline', mode: 'byo', spec: byoSpec() },
    {
      name: 'byo-model',
      mode: 'byo',
      spec: byoSpec({ model: 'claude-opus-4-6' }),
    },
    {
      name: 'byo-model-default',
      mode: 'byo',
      spec: byoSpec({ model: 'default' }),
    },
    {
      name: 'byo-kitchen-sink',
      mode: 'byo',
      spec: byoSpec({
        model: 'claude-opus-4-6',
        resume: GOLDEN_RESUME,
        instructions: GOLDEN_INSTRUCTIONS,
        additionalDirs: [...GOLDEN_DIRS],
        // bridgeUrl on a byo run pins that the bridge is NOT mounted (it is
        // authed by the managed session key); vision pins the byo half of
        // the vision wiring (browser tools still save images; no vision
        // env, which is gateway-scoped).
        mcp: { browser: 'headless', bridgeUrl: GOLDEN_BRIDGE_URL },
        execId: GOLDEN_EXEC_ID,
        vision: { model: GOLDEN_VISION_MODEL },
      }),
    },
  ];
}

/**
 * The canonical structure for one golden exec fixture, serialized as JSON:
 * the battery's case names in battery order, each exec with a fixed field
 * order and sorted env keys (env is a map — sorting is the deterministic
 * choice; argv, stdin bytes, and staged-file order are semantic and preserved
 * verbatim). The golden test parses this back and compares it structurally
 * against the parsed YAML fixture, so the fixture file's layout stays free for
 * the repo formatter — every semantic byte lives in the leaves either way.
 */
export function serializeExecFixture(
  cases: ReadonlyArray<{ name: string; exec: HarnessExec }>,
): string {
  const out: Record<string, unknown> = {};
  for (const { name, exec } of cases) {
    const env: Record<string, string> = {};
    for (const key of Object.keys(exec.env).sort()) {
      env[key] = exec.env[key];
    }
    out[name] = {
      argv: exec.argv,
      env,
      cwd: exec.cwd,
      ...(exec.stdin !== undefined && { stdin: exec.stdin }),
      ...(exec.stdinMode !== undefined && { stdinMode: exec.stdinMode }),
      ...(exec.stagedFiles !== undefined && { stagedFiles: exec.stagedFiles }),
    };
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * The frozen golden execs `fixtures/exec/<slug>.yml`, parsed to the same
 * plain structure `serializeExecFixture` builds — the YAML core schema yields
 * JSON-shaped data (strings, numbers, sequences, mappings), so the golden
 * test compares parsed structures directly and the file's layout stays free
 * for the repo formatter.
 */
export function readExecFixture(slug: string): unknown {
  const text = readFileSync(
    path.join(FIXTURES_DIR, 'exec', `${slug}.yml`),
    'utf8',
  );
  return parseYamlOrThrow(text);
}

/**
 * Drive a parser over `text` and collect every event, including the `end()`
 * flush. With `chunkSize` set, the text is fed in fixed-size slices that
 * split lines (and multibyte-free fixtures' records) at arbitrary offsets —
 * the incremental-contract half of every parser suite asserts this yields
 * the identical stream to one whole-text feed.
 */
export function collectEvents(
  parser: HarnessEventParser,
  text: string,
  chunkSize?: number,
): HarnessEvent[] {
  const events: HarnessEvent[] = [];
  if (chunkSize === undefined) {
    events.push(...parser.feed(text));
  } else {
    for (let i = 0; i < text.length; i += chunkSize) {
      events.push(...parser.feed(text.slice(i, i + chunkSize)));
    }
  }
  events.push(...parser.end());
  return events;
}
