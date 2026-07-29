// The ONE exec builder: interprets a harness YAML's declarative `exec` facts
// (`harnessConnectorSchema.exec` — see the vocabulary header in
// `lib/shared/schemas/providers.ts`) over a `HarnessRunSpec` and produces the
// `HarnessExec` the sandbox session-exec API runs. There is no per-harness
// build code; the golden fixtures under `fixtures/exec/` prove this
// interpreter reproduces the retired per-slug glue modules byte for byte.
//
// What stays code, by design:
//  - the named transforms the YAML may reference (claude's 1M-context model
//    marker, ultrathink prompt keyword, baseline house rules) — they read
//    operator env knobs and do content-dependent rewrites;
//  - the MCP server shapes (the in-container Playwright launcher command and
//    its headless/CDP argument sets, the capability-bridge command) — these
//    are platform facts shared by every harness, not per-harness facts;
//  - stream parsing (`parsers/`, keyed by the YAML's `parser` field).

import type {
  HarnessConnector,
  HarnessExecFacts,
} from '../shared/schemas/providers';
import { buildStdinUserMessage } from './parsers/claude-stream-json';
import type { HarnessExec, HarnessRunSpec } from './types';
import { DEFAULT_MAX_TURNS } from './types';

// ---------------------------------------------------------------------------
// Named transforms
// ---------------------------------------------------------------------------

/** Model families whose context window Claude Code expands to 1M when the
 * model string carries a trailing `[1m]` marker. Haiku is 200K-only and is
 * left untouched (it would just ignore the marker). */
const CONTEXT_1M_FAMILIES = ['opus', 'sonnet', 'fable'] as const;

/** True when the model id is a gateway ref (`provider/model…`) rather than a
 * vendor-native Claude Code id (`claude-*`). The `[1m]` window marker only
 * applies to the latter — the CLI strips it via its own model normalization
 * before the request, but gateway refs are passed through verbatim to the
 * virtual-key allowlist; appending `[1m]` breaks resolution and no completion
 * reaches the gateway. */
function isGatewayModelRef(model: string): boolean {
  return model.includes('/');
}

/** Default the in-sandbox agent to the maximum (1M) context window. Claude
 * Code gates its 1M window on a `[1m]` suffix on the model string and strips
 * that suffix BEFORE the request — so the provider / single-model virtual-key
 * allowlist only ever sees the bare model id (appending it cannot 404 the
 * key). Gateway-routed refs (`openrouter/…`) skip the marker — the CLI does
 * not strip it from slash-qualified ids. 1M carries no long-context premium
 * on current Opus, so it is on by default; an operator can force the 200K
 * default back with TALE_SANDBOX_CONTEXT_1M=0, and a model string that
 * already encodes a window (`…[1m]`) is left as-is. (Reasoning depth is the
 * separate CLAUDE_CODE_EFFORT_LEVEL knob — set as an overridable env floor in
 * the sandbox image, NOT here: a per-exec env value would override the user's
 * session env.) */
function withMaxContext(model: string): string {
  if (process.env.TALE_SANDBOX_CONTEXT_1M === '0') return model;
  if (isGatewayModelRef(model)) return model;
  const lower = model.toLowerCase();
  if (lower.includes('[1m]')) return model; // caller already chose a window
  if (!CONTEXT_1M_FAMILIES.some((family) => lower.includes(family))) {
    return model; // e.g. haiku — 200K only
  }
  return `${model}[1m]`;
}

/** Prepend Claude Code's `ultrathink` keyword to the turn prompt so every
 * turn requests maximum reasoning depth. On adaptive-thinking (Opus-class)
 * models the keyword is SAFE: the CLI injects a "reason thoroughly" reminder
 * for the turn — it does NOT set a `budget_tokens` (which would 400 there).
 * Complementary to CLAUDE_CODE_EFFORT_LEVEL=max (the primary depth lever).
 * Default-on; disable with TALE_SANDBOX_ULTRATHINK=0, and skipped when the
 * prompt already contains the keyword. */
function withUltrathink(prompt: string): string {
  if (process.env.TALE_SANDBOX_ULTRATHINK === '0') return prompt;
  if (/\bultrathink\b/i.test(prompt)) return prompt; // caller already asked
  return `Ultrathink: ${prompt}`;
}

/** Baseline working rules every Claude Code session carries, independent of
 * the per-agent (org-editable) instructions: git-attribution hygiene,
 * formatter-hook etiquette, the empty-catch ban, and honoring the working
 * repo's own AGENTS.md. Applied in code, so it reaches every Claude Code run
 * in every org and an org admin cannot drop it by editing their agent
 * config. */
const CLAUDE_CODE_HOUSE_RULES = [
  '## Notes',
  '',
  '- If the repository you are working in contains an AGENTS.md file, read it and follow its instructions.',
  "- Respect hooks that change formatting; don't hand-format or re-run a formatter.",
  '',
  '## Git',
  '',
  '- **Never** add `Co-Authored-By` to commit messages.',
  '- **Never** add "Generated with Claude Code" or any similar attribution to commits or PR descriptions.',
  '',
  '## Other',
  '',
  '- **Never** use an empty catch block — log (`console.warn`/`console.error`) or re-throw.',
].join('\n');

/** Prepend the baseline house rules to the composed instructions so they ride
 * on every session ahead of the turn's posture/safety addenda (the composed
 * payload ends with the untrusted-content block, which stays last).
 * Default-on; idempotent (skipped when already present); disabled with
 * TALE_SANDBOX_HOUSE_RULES=0. Returns the rules alone when nothing was
 * composed, so they apply even to an agent with empty instructions. */
function withHouseRules(instructions: string | undefined): string {
  const base = instructions ?? '';
  if (process.env.TALE_SANDBOX_HOUSE_RULES === '0') return base;
  if (base.includes(CLAUDE_CODE_HOUSE_RULES)) return base;
  return base
    ? `${CLAUDE_CODE_HOUSE_RULES}\n\n${base}`
    : CLAUDE_CODE_HOUSE_RULES;
}

const MODEL_TRANSFORMS = {
  'claude-max-context': withMaxContext,
} as const;

const PROMPT_TRANSFORMS = {
  'claude-ultrathink': withUltrathink,
} as const;

const INSTRUCTIONS_TRANSFORMS = {
  'claude-house-rules': withHouseRules,
} as const;

// ---------------------------------------------------------------------------
// MCP server shapes (platform facts shared by every harness)
// ---------------------------------------------------------------------------

/** In-container Playwright MCP launcher shim — it bridges the container's
 * HTTPS_PROXY/NO_PROXY into --proxy-server/--proxy-bypass (Chromium ignores
 * the env vars; the sandbox network is internal-only). */
const PLAYWRIGHT_MCP_COMMAND = 'tale-playwright-mcp';

/** Self-launch headless flags.
 * --browser chromium: the image ships chromium, not the default Google
 *   Chrome channel.
 * --isolated: in-memory profile — the default persistent profile dir lives
 *   under PLAYWRIGHT_BROWSERS_PATH, read-only at runtime.
 * --no-sandbox: the session container (cap-drop=ALL, no-new-privileges) has
 *   no unprivileged userns, so Chromium's zygote sandbox aborts at launch;
 *   the container itself is the isolation boundary.
 * --ignore-https-errors: this browser exists to test the apps the agent
 *   builds, which routinely serve over localhost with a self-signed cert or
 *   no TLS at all; without it, navigating to such a dev server fails closed
 *   with ERR_CERT_AUTHORITY_INVALID and there is no per-navigation override.
 *   The sandbox is isolated and egress-filtered, so this is not a
 *   general-purpose secure browser. */
const PLAYWRIGHT_MCP_ARGS = [
  '--headless',
  '--browser',
  'chromium',
  '--isolated',
  '--no-sandbox',
  '--ignore-https-errors',
] as const;

/** Live-browser-view args. Instead of self-launching a headless Chromium,
 * the MCP ATTACHES over CDP to the session's externally-managed HEADED
 * Chromium (loopback 127.0.0.1:9222) so the browser can be mirrored
 * read-only. The self-launch flags all belong to the now-externally-launched
 * browser and must be dropped — connectOverCDP ignores launch options. The
 * shim also skips the proxy flags in this mode; the managed browser already
 * carries the egress proxy. */
const PLAYWRIGHT_MCP_CDP_ARGS = [
  '--cdp-endpoint',
  'http://127.0.0.1:9222',
] as const;

/** Vision polyfill (text-only model): force the browser tools to SAVE images
 * (screenshots) to disk instead of returning them inline. An inline image
 * bypasses the Read hook and 400s on the text-only model; a saved file is
 * read via Read, where the vision hook transcribes it.
 * `browser_take_screenshot` still writes the file and its text result names
 * the path, so the agent reads it as usual. */
const PLAYWRIGHT_VISION_ARGS = ['--image-responses', 'omit'] as const;

/** The capability-dispatch bridge — lets the agent use the org's connected
 * connectors. The credential stays server-side; the bridge only relays
 * dispatch requests to the platform, authed by the session key. Because it
 * is authed by the minted session key it is managed-only: byo runs carry no
 * session key and therefore no bridge. */
const BRIDGE_MCP_COMMAND = 'tale-connectors-mcp';

// ---------------------------------------------------------------------------
// Placeholder substitution
// ---------------------------------------------------------------------------

/** Everything a placeholder can resolve to for one build. Absent fields make
 * a REFERENCING template an error — shipped YAMLs guard every reference with
 * the matching condition/slot gate, so a miss is a config defect. */
interface Substitutions {
  readonly [key: string]: string | undefined;
}

/** The closed placeholder set. `model.raw` is listed before `model` so the
 * longer name wins the alternation; unknown `${…}` sequences fall outside
 * the pattern and pass through byte-identically (several CLIs resolve their
 * own `${VAR}`/`{env:VAR}`/`$VAR` templates from staged config). */
const PLACEHOLDER_PATTERN =
  /\$\{(gateway\.baseUrl|gateway\.token|model\.raw|model|workdir|execId|prompt|vision\.model|bridgeUrl)\}/g;

/** SINGLE-PASS substitution: `String.replace` never rescans replacement
 * text, so a spec value containing `${gateway.token}` stays those literal
 * characters — user-influenced content can never pull a second substitution. */
function substitute(template: string, subs: Substitutions): string {
  return template.replace(PLACEHOLDER_PATTERN, (_, name: string) => {
    const value = subs[name];
    if (value === undefined) {
      throw new Error(
        `[harness exec] placeholder \${${name}} has no value in this build — gate the template on the matching condition`,
      );
    }
    return value;
  });
}

function substituteMap(
  map: Readonly<Record<string, string>>,
  subs: Substitutions,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = substitute(value, subs);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Config-document assembly
// ---------------------------------------------------------------------------

type DocTree = { [key: string]: unknown };

/** The ordered fragment list of one config document (schema-derived). */
type DocFragments = NonNullable<
  HarnessExecFacts['envDocs']
>[string]['fragments'];

function isTree(v: unknown): v is DocTree {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Clone a literal fragment tree, substituting placeholders in every string
 * — map KEYS included (opencode keys its per-model entry by `${model}`). */
function substituteTree(value: unknown, subs: Substitutions): unknown {
  if (typeof value === 'string') return substitute(value, subs);
  if (Array.isArray(value)) return value.map((v) => substituteTree(v, subs));
  if (isTree(value)) return substituteRecord(value, subs);
  return value;
}

/** The record-shaped case of {@link substituteTree}, typed as a tree so
 * fragment roots merge without an assertion. */
function substituteRecord(
  value: Readonly<Record<string, unknown>>,
  subs: Substitutions,
): DocTree {
  const out: DocTree = {};
  for (const [key, v] of Object.entries(value)) {
    out[substitute(key, subs)] = substituteTree(v, subs);
  }
  return out;
}

/** Deep-merge `src` into `target`: objects merge recursively, arrays and
 * scalars replace. JSON key order is first-insertion order — replacing an
 * existing key keeps its position — which the golden fixtures pin. */
function mergeTree(target: DocTree, src: DocTree): void {
  for (const [key, value] of Object.entries(src)) {
    const existing = target[key];
    if (isTree(existing) && isTree(value)) {
      mergeTree(existing, value);
    } else {
      target[key] = value;
    }
  }
}

/** Set `value` at a dotted `path`, creating objects along the way. */
function setPath(target: DocTree, path: string, value: unknown): void {
  const segments = path.split('.');
  let node = target;
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment];
    if (isTree(next)) {
      node = next;
    } else {
      const created: DocTree = {};
      node[segment] = created;
      node = created;
    }
  }
  node[segments[segments.length - 1]] = value;
}

export function buildHarnessExec(
  fact: HarnessConnector,
  spec: HarnessRunSpec,
): HarnessExec {
  const exec: HarnessExecFacts = fact.exec;
  const managed = spec.credential.mode === 'managed';
  const gateway = managed ? spec.credential.gateway : undefined;

  if (spec.credential.mode === 'byo' && !fact.credentialPolicy.byo) {
    // Managed-only harnesses (opencode) reject a byo credential outright; a
    // managed spec against a byo-only harness (cursor) builds inert instead
    // — it simply has no managed exec sections — matching the retired glue.
    throw new Error(
      `${fact.displayName} requires the managed gateway; a byo credential is not supported for ${fact.displayName}.`,
    );
  }

  // The condition atoms a `when` list ANDs over.
  const conditions: Record<'managed' | 'byo' | 'model' | 'no-model', boolean> =
    {
      managed,
      byo: spec.credential.mode === 'byo',
      model: spec.model !== undefined,
      'no-model': spec.model === undefined,
    };
  const holds = (
    when: ReadonlyArray<keyof typeof conditions> | undefined,
  ): boolean => (when ?? []).every((atom) => conditions[atom]);

  const subs: Substitutions = {
    'gateway.baseUrl': gateway?.baseUrl,
    'gateway.token': gateway?.token,
    model: spec.model,
    'model.raw': spec.model,
    workdir: spec.workdir,
    execId: spec.execId,
    prompt: spec.prompt,
    'vision.model': spec.vision?.model,
    bridgeUrl: spec.mcp?.bridgeUrl,
  };

  // Staged instructions path — computed up front so instructionsRef doc
  // fragments can reference it. Per-exec (keyed like the steer queue dir) so
  // concurrent turns from other threads sharing the workspace never read
  // each other's instructions; `${execId}` falls back to `default` here (a
  // missing exec id must not drop the instructions file).
  const stagedInstructionsPath =
    exec.stagedInstructions && spec.instructions
      ? substitute(exec.stagedInstructions.pathTemplate, {
          ...subs,
          execId: spec.execId ?? 'default',
        })
      : undefined;

  /** The requested MCP server table in one harness dialect, or undefined
   * when nothing mounts. Browser first, then the managed-only bridge —
   * matching the retired per-slug insertion order. */
  const buildMcpServers = (
    serverShape: 'command-args' | 'opencode-local',
    bridgeEnvField: string,
    bridgeEnv: Readonly<Record<string, string>>,
    visionOmitsImages: boolean,
  ): DocTree | undefined => {
    const servers: DocTree = {};
    if (spec.mcp?.browser) {
      const args = [
        ...(spec.mcp.browser === 'cdp'
          ? PLAYWRIGHT_MCP_CDP_ARGS
          : PLAYWRIGHT_MCP_ARGS),
        ...(visionOmitsImages && spec.vision ? PLAYWRIGHT_VISION_ARGS : []),
      ];
      servers.playwright =
        serverShape === 'command-args'
          ? { command: PLAYWRIGHT_MCP_COMMAND, args }
          : {
              type: 'local',
              command: [PLAYWRIGHT_MCP_COMMAND, ...args],
              enabled: true,
            };
    }
    if (spec.mcp?.bridgeUrl && managed) {
      const env = substituteMap(bridgeEnv, subs);
      servers.connectors =
        serverShape === 'command-args'
          ? { command: BRIDGE_MCP_COMMAND, [bridgeEnvField]: env }
          : {
              type: 'local',
              command: [BRIDGE_MCP_COMMAND],
              [bridgeEnvField]: env,
              enabled: true,
            };
    }
    return Object.keys(servers).length > 0 ? servers : undefined;
  };

  /** Assemble one config document from its ordered fragments. */
  const buildDoc = (fragments: DocFragments): DocTree => {
    const doc: DocTree = {};
    for (const fragment of fragments) {
      if ('set' in fragment) {
        if (!holds(fragment.when)) continue;
        mergeTree(doc, substituteRecord(fragment.set, subs));
      } else if ('maxTurns' in fragment) {
        setPath(doc, fragment.maxTurns.path, DEFAULT_MAX_TURNS);
      } else if ('mcpServers' in fragment) {
        const f = fragment.mcpServers;
        // Doc-borne MCP never applies the vision image-omit flags — only the
        // argv-borne claude delivery declares that behavior.
        const servers = buildMcpServers(
          f.serverShape,
          f.bridgeEnvField,
          f.bridgeEnv,
          false,
        );
        if (servers) setPath(doc, f.path, servers);
      } else if ('instructionsRef' in fragment) {
        if (stagedInstructionsPath !== undefined) {
          setPath(doc, fragment.instructionsRef.path, [
            `${fragment.instructionsRef.prefix}${stagedInstructionsPath}`,
          ]);
        }
      }
    }
    return doc;
  };

  // -------------------------------------------------------------------------
  // argv — the ordered slot walk
  // -------------------------------------------------------------------------
  const argv: string[] = [exec.bin];
  /** Env contributions collected while walking argv slots (model env maps,
   * the codex bridge env) — applied into the env assembly below. */
  const slotEnv: Record<string, string> = {};

  for (const slot of exec.argv) {
    if ('args' in slot) {
      argv.push(...slot.args.map((a) => substitute(a, subs)));
    } else if ('managedArgs' in slot) {
      if (managed) {
        argv.push(...slot.managedArgs.map((a) => substitute(a, subs)));
      }
    } else if ('byoArgs' in slot) {
      if (spec.credential.mode === 'byo') {
        argv.push(...slot.byoArgs.map((a) => substitute(a, subs)));
      }
    } else if ('posture' in slot) {
      const chunk =
        spec.posture === 'plan' ? slot.posture.plan : slot.posture.act;
      argv.push(...chunk.map((a) => substitute(a, subs)));
    } else if ('maxTurns' in slot) {
      argv.push(slot.maxTurns.flag, String(DEFAULT_MAX_TURNS));
    } else if ('additionalDirs' in slot) {
      for (const dir of spec.additionalDirs ?? []) {
        argv.push(slot.additionalDirs.flag, dir);
      }
    } else if ('resume' in slot) {
      if (spec.resume) argv.push(slot.resume.flag, spec.resume);
    } else if ('model' in slot) {
      const m = slot.model;
      if (spec.model && !m.omitValues?.includes(spec.model)) {
        const delivered = m.transform
          ? MODEL_TRANSFORMS[m.transform](spec.model)
          : spec.model;
        const modelSubs: Substitutions = { ...subs, model: delivered };
        if (managed && m.managedPrefixArgs) {
          argv.push(...m.managedPrefixArgs.map((a) => substitute(a, subs)));
        }
        argv.push(m.flag, m.value ? substitute(m.value, modelSubs) : delivered);
        if (m.env) Object.assign(slotEnv, substituteMap(m.env, modelSubs));
        if (managed && m.managedEnv) {
          Object.assign(slotEnv, substituteMap(m.managedEnv, modelSubs));
        }
      }
    } else if ('instructions' in slot) {
      const s = slot.instructions;
      const text = s.transform
        ? INSTRUCTIONS_TRANSFORMS[s.transform](spec.instructions)
        : (spec.instructions ?? '');
      if (text) {
        argv.push(
          s.flag,
          // `configKey` emits `<key>=<TOML basic string>` (codex `-c`);
          // JSON.stringify IS TOML basic-string encoding for our payloads.
          s.configKey ? `${s.configKey}=${JSON.stringify(text)}` : text,
        );
      }
    } else if ('mcp' in slot) {
      const m = slot.mcp;
      if (m.delivery === 'config-json-flag') {
        const servers = buildMcpServers(
          'command-args',
          'env',
          m.bridgeEnv,
          m.omitImagesOnVision === true,
        );
        if (servers) {
          argv.push(
            m.flag,
            JSON.stringify({ mcpServers: servers }),
            ...(m.trailingArgs ?? []),
          );
        }
      } else {
        // codex-config-flags: `-c mcp_servers.*` TOML pairs; the bridge
        // child env rides codex's env_vars whitelist — codex forwards ONLY
        // whitelisted vars from its own process env to MCP stdio servers —
        // so the session key stays out of argv and lands in the exec env.
        const tomlStringArray = (values: readonly string[]): string =>
          `[${values.map((v) => JSON.stringify(v)).join(',')}]`;
        if (spec.mcp?.browser) {
          argv.push(
            '-c',
            `mcp_servers.playwright.command=${JSON.stringify(PLAYWRIGHT_MCP_COMMAND)}`,
            '-c',
            `mcp_servers.playwright.args=${tomlStringArray(
              spec.mcp.browser === 'cdp'
                ? PLAYWRIGHT_MCP_CDP_ARGS
                : PLAYWRIGHT_MCP_ARGS,
            )}`,
          );
        }
        if (spec.mcp?.bridgeUrl && managed) {
          argv.push(
            '-c',
            `mcp_servers.connectors.command=${JSON.stringify(BRIDGE_MCP_COMMAND)}`,
            '-c',
            `mcp_servers.connectors.env_vars=${tomlStringArray(Object.keys(m.bridgeEnv))}`,
          );
          Object.assign(slotEnv, substituteMap(m.bridgeEnv, subs));
        }
      }
    } else if ('toolDeny' in slot) {
      const d = slot.toolDeny;
      const denied = [
        ...(d.always ?? []),
        ...(managed ? (d.managed ?? []) : []),
      ];
      if (denied.length > 0) argv.push(d.flag, denied.join(','));
    } else if ('prompt' in slot) {
      argv.push(spec.prompt);
    }
  }

  // -------------------------------------------------------------------------
  // stdin
  // -------------------------------------------------------------------------
  let stdin: string | undefined;
  let stdinMode: 'close' | 'hold' = 'close';
  if (exec.stdin.mode === 'prompt-text') {
    stdin = spec.prompt;
  } else if (exec.stdin.mode === 'ndjson-user-message') {
    const prompt = exec.stdin.promptTransform
      ? PROMPT_TRANSFORMS[exec.stdin.promptTransform](spec.prompt)
      : spec.prompt;
    stdin = buildStdinUserMessage(prompt);
    // Held open: the platform pushes steer messages as further NDJSON lines
    // while the process lingers; the runner sends EOF once the turn's
    // terminal event arrived and no background tasks remain.
    stdinMode = 'hold';
  } else if (exec.stdin.mode === 'json-envelope') {
    const envelope: DocTree = {};
    for (const entry of exec.stdin.envelope) {
      if ('prompt' in entry) {
        envelope.prompt = spec.prompt;
      } else if ('instructions' in entry) {
        if (spec.instructions) {
          envelope[entry.instructions.key] = spec.instructions;
        }
      } else if ('doc' in entry) {
        if (!holds(entry.doc.when)) continue;
        envelope[entry.doc.key] = buildDoc(entry.doc.fragments);
      }
    }
    stdin = JSON.stringify(envelope);
  }

  // -------------------------------------------------------------------------
  // env
  // -------------------------------------------------------------------------
  const env: Record<string, string> = {};
  if (exec.env?.base) Object.assign(env, substituteMap(exec.env.base, subs));
  if (managed && exec.env?.managed) {
    Object.assign(env, substituteMap(exec.env.managed, subs));
  }
  if (spec.credential.mode === 'byo') {
    // The caller-built credential env map merges VERBATIM — the caller keyed
    // it within the YAML's credentialEnvKeys; the interpreter neither
    // renames nor substitutes user credential values.
    Object.assign(env, spec.credential.env);
  }
  Object.assign(env, slotEnv);
  if (exec.vision && spec.vision && managed) {
    Object.assign(env, substituteMap(exec.vision.env, subs));
  }
  if (exec.steering && spec.execId) {
    Object.assign(env, substituteMap(exec.steering.env, subs));
  }
  for (const [varName, doc] of Object.entries(exec.envDocs ?? {})) {
    env[varName] = JSON.stringify(buildDoc(doc.fragments));
  }

  // -------------------------------------------------------------------------
  // staged files + subscription delivery
  // -------------------------------------------------------------------------
  const stagedFiles: Array<{ path: string; content: string }> = [];
  if (stagedInstructionsPath !== undefined && spec.instructions) {
    stagedFiles.push({
      path: stagedInstructionsPath,
      content: spec.instructions,
    });
  }
  if (spec.subscription && fact.subscription) {
    if (fact.subscription.kind === 'env') {
      // Applied after the credential env so the subscription secret
      // overrides a same-named auth var (claude's ANTHROPIC_AUTH_TOKEN).
      env[fact.subscription.tokenVar] = spec.subscription.secret;
      if (fact.subscription.baseUrlVar && spec.subscription.baseUrl) {
        env[fact.subscription.baseUrlVar] = spec.subscription.baseUrl;
      }
    } else {
      stagedFiles.push({
        path: fact.subscription.path,
        content: spec.subscription.secret,
      });
    }
  }

  return {
    argv,
    env,
    cwd: spec.workdir,
    ...(stdin !== undefined && { stdin }),
    stdinMode,
    ...(stagedFiles.length > 0 && { stagedFiles }),
  };
}
