/**
 * Live-model eval for two-tier tool gating (#2781).
 *
 * Measures TOOL-SELECTION behavior — the thing unit tests and the mock stack
 * cannot see — against a real model, using the REAL registry tool schemas
 * (execute stripped: nothing ever runs) and the REAL builtin assistant
 * instructions.
 *
 * Modes compared per case:
 *  - `full`:  every bound tool on the wire (pre-gating shape).
 *  - `gated`: core + request_capabilities; when the model calls the
 *    meta-tool, the harness unlocks the group and replays the exchange so
 *    the model's SECOND step is measured too — mirroring the production
 *    prepareStep flow.
 *
 * Usage:
 *   TALE_PROVIDER_KEY_OPENROUTER=... bun scripts/eval-tool-gating.ts [--model <id>] [--only <case-id>]
 *
 * Cost: ~35 cases × ≤2 calls on claude-haiku — well under a dollar per run.
 * Report-only: prints a per-case table + category rollup; exits 1 only when
 * the gated pass rate drops below the full pass rate by more than 10 points
 * (regression signal, tolerant of single-case flakes).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';

import { createRequestCapabilitiesTool } from '../convex/agent_tools/capabilities/request_capabilities_tool';
import {
  computeActiveToolNames,
  createToolGatingState,
  GATED_TOOL_GROUPS,
  groupById,
  lockedGroupsFor,
  REQUEST_CAPABILITIES_TOOL_NAME,
} from '../convex/agent_tools/tool_gating';
import { getToolRegistryMap } from '../convex/agent_tools/tool_registry';

const ASSISTANT_TOOLS = [
  'rag_search',
  'web',
  'document_retrieve',
  'document_find',
  'document_write',
  'image',
  'generate_image',
  'request_human_input',
  'file_write',
  'file_edit',
  'file_read',
  'file_list',
  'run_code',
  'request_user_location',
  'file_delete',
] as const;

interface EvalCase {
  id: string;
  prompt: string;
  /**
   * Acceptable outcomes, by mode:
   *  - `direct`: tools the model may call immediately (full mode expects one
   *    of these; gated mode expects one of these too when they're core).
   *  - `group`: for gated-tool cases — gated mode expects
   *    request_capabilities(group) first, then one of `direct` on step 2.
   *  - `none`: a plain text answer (no tool call) is the right behavior.
   */
  direct?: string[];
  group?: string;
  none?: boolean;
}

const CASES: EvalCase[] = [
  // --- no tool expected -------------------------------------------------
  { id: 'greet', prompt: 'hello!', none: true },
  { id: 'thanks', prompt: 'thanks, that was helpful!', none: true },
  { id: 'smalltalk', prompt: 'how are you today?', none: true },
  { id: 'arith', prompt: 'What is 17 + 25? Answer in one word.', none: true },
  {
    id: 'general-knowledge',
    prompt: 'In one sentence: why is the sky blue?',
    none: true,
  },
  // --- core tools (identical behavior expected in both modes) ----------
  {
    id: 'kb-policy',
    prompt: 'What does our vacation policy say about carrying over days?',
    direct: ['rag_search'],
  },
  {
    id: 'kb-doc-question',
    prompt: 'Search our knowledge base for the onboarding checklist.',
    direct: ['rag_search'],
  },
  {
    id: 'web-fetch',
    prompt:
      'Fetch https://example.com/pricing and summarize the tiers it lists.',
    direct: ['web'],
  },
  {
    id: 'doc-find',
    prompt: 'Which documents do we have in the contracts folder?',
    direct: ['document_find', 'rag_search'],
  },
  {
    id: 'doc-read',
    prompt:
      'Open the document with file id kg2bazp7fbgt9srq63knfagjrd7yfenj and give me its first section.',
    direct: ['document_retrieve', 'rag_search'],
  },
  {
    id: 'ask-user-choice',
    prompt:
      'I need you to pick my top 3 priorities from my list of eight projects — ask me which ones matter most first.',
    direct: ['request_human_input'],
  },
  // --- workspace group --------------------------------------------------
  {
    id: 'run-python',
    prompt:
      'Run some Python to compute the 30th Fibonacci number exactly and show me the result of executing it.',
    direct: ['run_code', 'file_write'],
    group: 'workspace',
  },
  {
    id: 'write-csv',
    prompt:
      'Create a file named report.csv in the workspace with three example rows of sales data.',
    direct: ['file_write'],
    group: 'workspace',
  },
  {
    id: 'simulate',
    prompt:
      'Write and execute a Monte Carlo simulation (10k samples) estimating pi, and give me the numeric estimate from actually running it.',
    direct: ['run_code', 'file_write'],
    group: 'workspace',
  },
  {
    id: 'edit-file',
    prompt:
      'In the workspace file /user/code/gen.py, replace the constant SEED = 1 with SEED = 42.',
    direct: ['file_edit'],
    group: 'workspace',
  },
  {
    id: 'list-files',
    prompt: 'What files are currently in my workspace?',
    direct: ['file_list'],
    group: 'workspace',
  },
  // --- images group -----------------------------------------------------
  {
    id: 'gen-image',
    prompt: 'Generate an image of a lighthouse at sunset in watercolor style.',
    direct: ['generate_image'],
    group: 'images',
  },
  {
    id: 'gen-logo',
    prompt: 'Create a minimalist logo image for a coffee brand called Bern.',
    direct: ['generate_image'],
    group: 'images',
  },
  // --- documents_write group -------------------------------------------
  {
    id: 'doc-write',
    prompt:
      'Create a new document in our Document Hub titled "Team Rituals" with a short intro paragraph.',
    direct: ['document_write'],
    group: 'documents_write',
  },
  // --- location group ---------------------------------------------------
  {
    id: 'weather-near-me',
    prompt: 'What is the weather like near me right now?',
    direct: ['request_user_location', 'web'],
    group: 'location',
  },
  {
    id: 'nearby',
    prompt: 'Find a good lunch spot near my current location.',
    direct: ['request_user_location'],
    group: 'location',
  },
];

interface CliArgs {
  model: string;
  only?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = { model: 'anthropic/claude-haiku-4.5' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) out.model = args[++i];
    if (args[i] === '--only' && args[i + 1]) out.only = args[++i];
  }
  return out;
}

function loadInstructions(): string {
  const path = fileURLToPath(
    new URL(
      '../../../builtin-configs/agents/chat/assistant.json',
      import.meta.url,
    ),
  );
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    i18n?: { en?: { systemInstructions?: unknown } };
  };
  const instructions = parsed.i18n?.en?.systemInstructions;
  if (typeof instructions !== 'string' || instructions.length === 0) {
    throw new Error('assistant.json has no i18n.en.systemInstructions');
  }
  return instructions;
}

const GATING_NOTE =
  '\n\nSome capability groups (code execution + file workspace, image tools, document writing, user location) start LOCKED to keep requests lean. When the task needs one, call `request_capabilities` with the group id first — it unlocks for the rest of the conversation.';

/** Registry tools with execute stripped — schemas on the wire, nothing runs. */
function buildSchemaOnlyTools(): Record<string, unknown> {
  const registry = getToolRegistryMap();
  const tools: Record<string, unknown> = {};
  for (const name of ASSISTANT_TOOLS) {
    const def = registry[name];
    const t = def.tool as Record<string, unknown>;
    tools[name] = { ...t, execute: undefined };
  }
  const meta = createRequestCapabilitiesTool({
    state: createToolGatingState(),
    threadId: 'eval-thread',
    allToolNames: [...ASSISTANT_TOOLS],
  });
  tools[meta.name] = {
    ...(meta.tool as Record<string, unknown>),
    execute: undefined,
  };
  return tools;
}

interface StepResult {
  toolName: string | undefined;
  toolInput: unknown;
  toolCallId: string | undefined;
}

async function runCase(
  c: EvalCase,
  mode: 'full' | 'gated',
  deps: {
    model: ReturnType<ReturnType<typeof createOpenAICompatible>>;
    tools: Record<string, unknown>;
    system: string;
  },
): Promise<{ pass: boolean; detail: string }> {
  const state = createToolGatingState();
  const activeFor = () =>
    mode === 'full'
      ? [...ASSISTANT_TOOLS]
      : computeActiveToolNames([...ASSISTANT_TOOLS], state);

  const messages: ModelMessage[] = [{ role: 'user', content: c.prompt }];
  const step = async (): Promise<StepResult> => {
    const result = await generateText({
      model: deps.model,
      system: deps.system,
      messages,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- schema-only tool records are structurally AI-SDK tools
      tools: deps.tools as ToolSet,
      activeTools: activeFor(),
      stopWhen: stepCountIs(1),
      temperature: 0,
      maxOutputTokens: 700,
    });
    const call = result.toolCalls[0];
    if (call) {
      messages.push(...result.response.messages);
    }
    return {
      toolName: call?.toolName,
      toolInput: call?.input,
      toolCallId: call?.toolCallId,
    };
  };

  const first = await step();

  if (c.none) {
    return first.toolName === undefined
      ? { pass: true, detail: 'no tool (correct)' }
      : { pass: false, detail: `unexpected tool ${first.toolName}` };
  }

  const direct = c.direct ?? [];
  if (mode === 'full' || !c.group) {
    return first.toolName !== undefined && direct.includes(first.toolName)
      ? { pass: true, detail: `called ${first.toolName}` }
      : {
          pass: false,
          detail: `called ${first.toolName ?? 'nothing'} (wanted ${direct.join('|')})`,
        };
  }

  // Gated mode, gated case: expect the meta-tool with the right group first.
  if (first.toolName !== REQUEST_CAPABILITIES_TOOL_NAME) {
    // Direct call of a core alternative (e.g. web for weather) also counts.
    if (first.toolName !== undefined && direct.includes(first.toolName)) {
      return { pass: true, detail: `direct core ${first.toolName}` };
    }
    return {
      pass: false,
      detail: `called ${first.toolName ?? 'nothing'} (wanted request_capabilities:${c.group})`,
    };
  }
  const input = first.toolInput as { groups?: string[] } | undefined;
  const requested = input?.groups ?? [];
  if (!requested.includes(c.group)) {
    return {
      pass: false,
      detail: `unlocked ${requested.join(',') || 'nothing'} (wanted ${c.group})`,
    };
  }
  for (const id of requested) if (groupById(id)) state.unlockedGroupIds.add(id);
  messages.push({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: first.toolCallId ?? 'call_0',
        toolName: REQUEST_CAPABILITIES_TOOL_NAME,
        output: {
          type: 'json',
          value: {
            unlocked: requested,
            note: 'The requested capabilities are now active — continue with the task using the newly available tools.',
          },
        },
      },
    ],
  });
  const second = await step();
  return second.toolName !== undefined && direct.includes(second.toolName)
    ? { pass: true, detail: `unlock ${c.group} → ${second.toolName}` }
    : {
        pass: false,
        detail: `after unlock called ${second.toolName ?? 'nothing'} (wanted ${direct.join('|')})`,
      };
}

async function main() {
  const cli = parseArgs();
  const apiKey = process.env.TALE_PROVIDER_KEY_OPENROUTER;
  if (!apiKey) {
    console.error('TALE_PROVIDER_KEY_OPENROUTER is not set');
    process.exit(1);
  }
  const provider = createOpenAICompatible({
    name: 'openrouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
  });
  const model = provider(cli.model);
  const tools = buildSchemaOnlyTools();
  const system = loadInstructions();

  const cases = cli.only ? CASES.filter((c) => c.id === cli.only) : CASES;
  const results: Record<
    'full' | 'gated',
    Array<{ id: string; pass: boolean; detail: string }>
  > = { full: [], gated: [] };

  for (const mode of ['full', 'gated'] as const) {
    const sys = mode === 'gated' ? system + GATING_NOTE : system;
    let active = 0;
    const queue = [...cases];
    await new Promise<void>((resolve) => {
      const next = () => {
        if (queue.length === 0 && active === 0) return resolve();
        while (active < 4 && queue.length > 0) {
          const c = queue.shift();
          if (!c) break;
          active++;
          void runCase(c, mode, { model, tools, system: sys })
            .catch((err: unknown) => ({
              pass: false,
              detail: `ERROR ${err instanceof Error ? err.message : String(err)}`,
            }))
            .then((r) => {
              results[mode].push({ id: c.id, ...r });
              active--;
              next();
            });
        }
      };
      next();
    });
  }

  for (const mode of ['full', 'gated'] as const) {
    console.log(`\n=== ${mode.toUpperCase()} ===`);
    for (const r of results[mode].sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(
        `${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(20)} ${r.detail}`,
      );
    }
    const passed = results[mode].filter((r) => r.pass).length;
    console.log(`${mode}: ${passed}/${results[mode].length}`);
  }

  const fullRate = results.full.filter((r) => r.pass).length / cases.length;
  const gatedRate = results.gated.filter((r) => r.pass).length / cases.length;
  console.log(
    `\nfull ${(fullRate * 100).toFixed(0)}% vs gated ${(gatedRate * 100).toFixed(0)}%`,
  );
  if (gatedRate < fullRate - 0.1) {
    console.error('REGRESSION: gated selection quality dropped >10 points');
    process.exit(1);
  }
}

await main();
