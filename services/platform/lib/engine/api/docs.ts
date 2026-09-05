/**
 * Agent-facing documentation, generated from the registry so it can never
 * drift from behavior — and honest by construction: DOC_EXAMPLE renders into
 * the docs AND is executed by the selftest, so every documented example is a
 * proven, passing automation.
 *
 * Content decisions are measured: YAML-first documents, verbose docs (terse
 * docs cost accuracy AND turns), TS-style output signatures, and no inline
 * catalog dump — capability discovery goes through search_catalog.
 */

import { stringifyYaml } from '../../shared/config/yaml';
import { nodeTypes } from '../core/slots';
import type { Automation } from '../core/types';

/** The worked example woven through the docs — executed by the selftest.
 * Core node types only, so it runs on a bare engine with no connectors. */
export const DOC_EXAMPLE: {
  automation: Automation;
  input: Record<string, unknown>;
} = {
  automation: {
    version: 1,
    name: 'order-report',
    inputs: {
      type: 'object',
      properties: {
        min_total: { type: 'number' },
        orders: { type: 'array' },
      },
      required: ['min_total', 'orders'],
    },
    nodes: [
      {
        id: 'calc',
        type: 'transform',
        input: {
          orders: '{{ input.orders }}',
          min: '{{ input.min_total }}',
        },
        code: 'const sel = input.orders.filter(o => o.total >= input.min);\nreturn { count: sel.length, sum: sel.reduce((s, o) => s + o.total, 0) };',
      },
      {
        id: 'summary',
        type: 'llm',
        model: 'anthropic/claude-haiku-4-5',
        when: '{{ nodes.calc.output.count > 0 }}',
        prompt:
          'One sentence for sales: {{ nodes.calc.output.count }} qualifying orders totaling {{ nodes.calc.output.sum }}.',
      },
      {
        id: 'summary_empty',
        type: 'transform',
        elseOf: 'summary',
        code: 'return { text: "No qualifying orders." };',
      },
    ],
    output: {
      stats: '{{ nodes.calc.output }}',
      message:
        '{{ nodes.summary.output ? nodes.summary.output.text : nodes.summary_empty.output.text }}',
    },
    tests: [
      {
        name: 'empty order list reports zero',
        input: { min_total: 100, orders: [] },
        expect: {
          output: {
            stats: { count: 0, sum: 0 },
            message: 'No qualifying orders.',
          },
        },
      },
    ],
  },
  input: {
    min_total: 100,
    orders: [{ total: 250 }, { total: 40 }],
  },
};

function connectorLines(): string {
  const lines = [...nodeTypes().values()]
    .filter((d) => d.kind === 'connector' && d.connector)
    .map((d) => {
      const i = d.connector;
      if (!i) return '';
      const schema = i.inputSchema;
      const properties =
        schema.properties &&
        typeof schema.properties === 'object' &&
        !Array.isArray(schema.properties)
          ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the object check above
            (schema.properties as Record<string, Record<string, unknown>>)
          : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      const props = Object.entries(properties)
        .map(([k, v]) => {
          const req = required.includes(k);
          const t = Array.isArray(v.enum)
            ? v.enum.map((e) => JSON.stringify(e)).join('|')
            : typeof v.type === 'string'
              ? v.type
              : 'unknown';
          return `${k}${req ? '' : '?'}: ${t}`;
        })
        .join(', ');
      return `   - ${i.name}  input {${props}} → output ${i.outputSignature}\n     ${i.description}`;
    })
    .filter(Boolean);
  return lines.length > 0
    ? lines.join('\n')
    : '   (none registered on this engine yet — discover with search_catalog once the host installs connectors)';
}

/** The full engine guide an agent needs to author automations. */
export function agentDocs(): string {
  return `You are an autonomous automation builder operating the automation engine. There is no human in the loop.

## Protocol
Every reply MUST contain exactly ONE action in a fenced yaml block (a short sentence before it is OK, nothing after it):

\`\`\`yaml
method: run_automation
params:
  automation:
${stringifyYaml(DOC_EXAMPLE.automation)
  .trimEnd()
  .split('\n')
  .map((l) => `    ${l}`)
  .join('\n')}
  input: ${JSON.stringify(DOC_EXAMPLE.input)}
\`\`\`

Authoring methods:
- get_docs             params {}                      → this guide
- get_catalog          params {}                      → the registered capability list (compact)
- search_catalog       params {query}                 → find capabilities by keywords
- validate_automation  params {automation}            → static analysis only
- run_automation       params {automation, input}     → validate + execute against the deterministic mocks with a test input; returns output, per-node trace, effects
- test_automation      params {automation}            → run the automation's own tests: block
- save_automation      params {automation, message?}  → save as a new immutable version
- get_automation       params {name, version?}        → fetch a saved version
- list_automations     params {}                      → saved automations with their latest versions
- deploy_automation    params {name, version}         → mark the version triggers run
- set_trigger          params {name, trigger}         → host-managed trigger binding
- run_deployed         params {name, input}           → run the deployed version (live on a deployment) and WAIT for the finished result; a run that outlives the wait answers with its runId to poll
(run_automation validates automatically — you rarely need validate_automation.)

Management methods — they read and steer what the host has persisted:
- start_run            params {name, input?, version?, projectId?} → hand the run to the host and return {runId, version} IMMEDIATELY; poll get_run (projectId scopes the run to one project; omit for org-wide)
- list_runs            params {name?, limit?}         → recent runs, newest first
- get_run              params {runId}                 → one run in full: status, output, trace, effects
- cancel_run           params {runId}                 → stop a run at its next node boundary
- list_versions        params {name}                  → the immutable version history
- list_triggers        params {name?}                 → what starts the automations (never the webhook secret)
- delete_trigger       params {name}                  → unbind the trigger; versions and run history stay
(run_deployed vs start_run: run_deployed answers with the finished result and is
what you want while building; start_run answers with a handle and is what you
want for a long automation you will poll.)

The platform serves three more tools on the same endpoint —
search_capabilities, invoke_capability and get_knowledge. They are NOT engine
methods and are not documented here: they reach the organization's capability
registry and knowledge base, and describe themselves in their own schemas.

## Automation document
An automation is a node graph. Execution order is computed automatically from data references; list order does not matter and there is NO "edges" field. All nodes run unless skipped. Documents start with version: 1.
- "inputs": JSON Schema describing the runtime input.
- "output": the automation's return value (templates allowed inside).
- "tests": [{name, input, expect: {output?, effects?: [{connector, input}]}}] — acceptance tests run by test_automation.

YAML gotchas (top causes of failure):
- ALWAYS double-quote any string containing {{ }} or starting with # — unquoted they break YAML.
- Multi-line "code" uses a YAML block scalar (code: | then indented lines).
- Indent consistently with 2 spaces; list items start with "- ".

## Templates
"{{ expr }}" — a JavaScript expression. Scope: input (the runtime input object), nodes.<id>.output (a node's result), and item/index under forEach.
- A field that is exactly one template keeps the value's type: "{{ input.n }}" → number
- Mixed text interpolates: "Temp: {{ nodes.w.output.tempC }}°C" — interpolating a missing value is an error.
- ALWAYS read node results via .output — nodes.w.output.tempC ✓   nodes.w.tempC ✗

## Node kinds
Every node has "id" (unique snake_case) and "type", plus optional control flow:
- "when": "{{ <boolean> }}" — skip the node when falsy; nodes reading a skipped node's output skip too; in the automation output a skipped node's output is null.
- "elseOf": "<node id>" — run exactly when that node was when-skipped (exclusive else-branch).
- "forEach": "{{ <array expr> }}" — run once per item (use item / item.total); the node's output becomes the ARRAY of results.
- "repeatUntil": "{{ <boolean> }}" with "maxRepeats": <1..20> — re-run the node until true (poll async jobs). The in-flight result is available as output (or this node's own nodes.<id>.output).
- "onError": "continue" — record the failure, skip dependents, keep running (default stops the run).

1. transform — pure JavaScript for reshaping data (no network, no imports).
   "code" is a function body; "input" is this node's own evaluated input object (define what the code needs). It MUST return a value.

2. llm — call a language model. "model" is required and always explicit — the engine never picks one for you.
   {id, type: llm, model: "<model id>", system?: "...", prompt: "... {{ nodes.get.output }} ..."} → output {text: string}
   With "outputSchema" (a JSON Schema), the output becomes the schema-shaped OBJECT instead — this is the one bridge from free text to structured data, and the fix for "an unstructured output has no fields".

3. agent — run ONE turn of an external coding agent (Claude Code, Codex, …) in the sandbox. "model" and "prompt" are required and explicit.
   {id, type: agent, model: "<model id>", modelProvider?: "<provider slug>", prompt: "...", system?: "...", harness?: "claude-code", skills?: ["<skill slug>"], connectors?: ["<connector slug>"], tools?: ["task_find", "task_create", …], secrets?: ["GLITCHTIP_TOKEN"], files?: {"setup": "{{ input.setupFolderId }}"}} → output {text, files: [{name, storageId, size, contentType}], status}
   "modelProvider" pins which configured provider serves (and bills) the model, honored fail-closed at run time. Set it only when the user names a provider; omit it otherwise — the host resolves one.
   "files" stages folders/documents into the agent workspace; whatever the agent writes to its output directory comes back as output.files. "tools" grants platform workspace tools — reads (task_find, task_get, document_find, knowledge_entry_find, contact_find, product_find, website_find) and writes (task_create, task_comment, task_update_status, task_upsert_by_external_ref, document_create); a write grant is the standing authorization (no per-call approval). "secrets" injects the org's named agentSecrets as environment variables (a scoped API key for a service with no connector). Use llm for a one-shot completion; use agent ONLY when the step needs tools, staged files, or multiple turns — it is slower and costs more.

4. subautomation — run a saved automation as a node: {id, type: subautomation, automation: "name" or "name@version", input: {...its runtime input...}} → its output. Nesting max 3.

5. capability nodes — connectors to external apps and platform tools. Set "type" to the capability's own name (never "connector"); data goes in "input" and must match its schema:
${connectorLines()}
   Capability nodes accept NO other fields. During testing they are deterministic mocks: same input → same output. Discover more with search_catalog.

## Results you get back
run_automation returns {status, output, trace, effects}:
- trace: each node's resolved input and actual output — read it to see real data shapes.
- effects: every external call (message/email/llm/…) with its input.
Compare output and effects to the requirements character by character.

## How to work
1. Draft the complete automation, then call run_automation with a realistic test input.
2. If it fails, read error + hint + trace, fix the automation, run again.
3. When the run output and effects EXACTLY match the requirements, attach a tests: block and verify with test_automation.
4. Finish per your task's instructions (save_automation after tests pass, then deploy_automation when asked).

## Pre-submit checklist — run through it EVERY time before finishing
1. Did run_automation succeed with a realistic test input?
2. Does the output match the required shape and strings EXACTLY (character by character, correct types)?
3. Do the effects match exactly — right channel/recipient, exact text, correct count, nothing extra?
4. Only if all three are yes → finish. Otherwise fix and re-run first.

## Reflection rule
Whenever a result shows a failure (validation error, execution error, wrong output, rejected finish), begin your reply with exactly one line "CAUSE: <one-sentence diagnosis>", then output the corrected action.`;
}
