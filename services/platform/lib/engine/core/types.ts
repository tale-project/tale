/**
 * Core data model — the stable public types of the automation engine.
 *
 * An automation is a single document: a DAG of typed nodes. Edges are DERIVED
 * from `{{ nodes.<id>.output }}` references, never declared — one source of
 * truth that maps 1:1 onto a visual canvas (node = box, reference = edge,
 * control-flow fields = badges). No logic exists outside nodes.
 *
 * Documents are YAML-first (agents author YAML far more reliably than JSON),
 * and every API equally accepts the equivalent JSON object.
 */

import type { NodeRunRecord, StepFailure } from './record/types';

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

/**
 * One node of the graph. Exactly one behavior per `type`:
 *  - `transform`      — sandboxed JavaScript over its resolved `input`
 *  - `llm`            — language-model call with a templated prompt and an
 *                       explicit, caller-chosen model
 *  - `agent`          — one turn of an external coding agent in the sandbox,
 *                       with staged files, skills and brokered connectors
 *  - `subautomation`  — run a saved automation as a node
 *  - any registered capability name (connector actions, platform natives
 *    such as knowledge search) — an external connector
 */
export interface NodeDef {
  /** Unique within the automation; `^[a-z][a-z0-9_]{0,49}$`. */
  id: string;
  type: string;

  // Declarative control flow — the engine owns iteration and branching so
  // per-item work stays visible in the trace instead of hiding inside code.
  /** Skip the node when this template is falsy; dependents skip too. */
  when?: string;
  /** Run exactly when the named node was `when`-skipped (exclusive else). */
  elseOf?: string;
  /** Template resolving to an array: run once per item; the node's output
   * becomes the array of per-item outputs. */
  forEach?: string;
  /** Re-run the node until this template is truthy (`output` in scope). */
  repeatUntil?: string;
  /** Iteration cap for `repeatUntil` (default 5, max 20). */
  maxRepeats?: number;
  /** `fail` (default) halts the run; `continue` records the error and skips
   * dependents. */
  onError?: 'fail' | 'continue';

  // Per-type payloads.
  /** Connector/transform input mapping; template strings allowed in
   * values. */
  input?: Record<string, unknown>;
  /** transform: a JavaScript function body over `input`/`nodes` (+ `item`
   * and `index` under forEach); it MUST return a value. */
  code?: string;
  /** llm/agent: the user prompt template. */
  prompt?: string;
  /** llm/agent: optional system prompt. */
  system?: string;
  /**
   * llm/agent: the model to call — REQUIRED and always explicit. The engine
   * never picks a model on the author's behalf; availability and access are
   * the host's concern.
   */
  model?: string;
  /**
   * agent: the provider slug that serves `model` — the editor picker saves
   * the pair. Optional; when present the host honors it fail-closed instead
   * of walking every connector (which provider serves — and bills — the turn
   * stops being an ordering accident).
   */
  modelProvider?: string;
  /**
   * llm: when present, a JSON Schema the reply must satisfy — the node's
   * output becomes the parsed object instead of `{text}`. This is the one
   * sanctioned bridge from unstructured text to structured data.
   */
  outputSchema?: Record<string, unknown>;
  /**
   * agent: the coding-agent harness that runs the turn (`claude-code`,
   * `codex`, …). Optional — the host's default harness applies when absent.
   */
  harness?: string;
  /** agent: org skill slugs staged into the session before the turn. */
  skills?: string[];
  /** agent: connector slugs the turn may reach through the broker. */
  connectors?: string[];
  /** agent: platform workspace-tool grants beyond the baseline — the task
   * family, the document and knowledge-entry reads and writes, and the
   * contact, product and website reads (`AGENT_TOOL_CATALOG`). A write grant
   * is the standing authorization for that write. */
  tools?: string[];
  /** agent: names of org `agentSecrets` injected as environment variables for
   * the turn (BYO API keys for services with no shipped connector). */
  secrets?: string[];
  /**
   * agent: workspace staging map — mount name → a document/folder reference
   * (templates allowed in values). The host stages each entry under the
   * session workspace before the turn starts.
   */
  files?: Record<string, unknown>;
  /** subautomation: a saved reference, `"name"` or `"name@version"`. */
  automation?: string;
}

/**
 * A first-class acceptance test stored with the automation: an input, the
 * calls it stands in for, and what the run must do.
 *
 * A stand-in replaces a node's CALL, never the node: the skip rules apply as
 * written, the node's input is still resolved and its effect recorded, and
 * only then does the simulated output (or failure) take the place of what
 * the connector, model, agent, called automation or code would have
 * answered. Stand-ins name top-level nodes only, and apply to mock runs.
 */
export interface AutomationTest {
  name: string;
  /** What the test is about, for people; never interpreted. */
  description?: string;
  input: Json;
  /** Node id → the output that node returns in this test instead of
   * calling. For a forEach node, a list: item i returns entry i. */
  mocks?: Record<string, Json>;
  /** Node id → the error that node fails with in this test instead of
   * calling; its onError applies. */
  failures?: Record<string, string>;
  expect?: TestExpectation;
}

/** What happened to a node in a run, as a test expects it. `failed`: it
 * failed and the run went on (`onError: continue`). */
export type ExpectedNodeState = 'ran' | 'skipped' | 'failed';

/** One effect a test expects — or, with `absent`, expects not to happen. */
export interface ExpectedEffect {
  connector: string;
  /** Only an effect of this node; a subautomation's inner effects read
   * `<node>/<inner>`. */
  node?: string;
  /** The effect's input equals this exactly. */
  input?: unknown;
  /** The effect's input contains this, the way `outputIncludes` compares. */
  inputIncludes?: unknown;
  /** No such effect occurs. */
  absent?: true;
}

/** What a run must do for its test to pass. Every expectation given is
 * judged; a run that ends otherwise than expected fails the test. */
export interface TestExpectation {
  /** The run's output equals this exactly. */
  output?: unknown;
  /** The run's output contains this: every listed key matches, recursively;
   * lists compare position by position and must have the same length;
   * unlisted keys are not checked. */
  outputIncludes?: unknown;
  /** Each entry must occur — or, with `absent: true`, must not occur. */
  effects?: ExpectedEffect[];
  /** What happened to these nodes. */
  nodes?: Record<string, ExpectedNodeState>;
  /** The run must fail — at this node when it is named, with an error that
   * contains this message (any case) when it is given. Excludes `output`
   * and `outputIncludes`. */
  failure?: { node?: string; message?: string };
}

/**
 * The bench a run uses: a test's stand-ins, plus a narrower scope for a
 * step test. The scope (`upTo`, `only`, `item`) is for a run executed in
 * one call; a stored run takes a test's stand-ins only. Every bench applies
 * to mock runs only.
 */
export interface RunBench {
  mocks?: Record<string, Json>;
  failures?: Record<string, string>;
  /** Run only what this node needs, then stop: the run's output is this
   * node's output. */
  upTo?: string;
  /** Run this node alone on pinned data: every node it reads must be in
   * `mocks`, and is not evaluated. */
  only?: string;
  /** With `only` on a forEach node: run this item alone (0-based). */
  item?: number;
  /** The test this bench came from. */
  test?: { name: string; index?: number };
}

/** How a bench stood in for a node: its call returned a simulated output,
 * it was pinned data, its call failed as the test said, or the step test
 * left it out. */
export type BenchMark = 'mocked' | 'pinned' | 'failed' | 'left-out';

export interface Automation {
  /** Document schema version; v1 documents declare `version: 1`. */
  version?: number;
  /** Kebab-case; also the store identity. */
  name: string;
  description?: string;
  /** JSON Schema for the runtime input. */
  inputs?: Record<string, unknown>;
  nodes: NodeDef[];
  /** The automation's return value; templates allowed anywhere inside. */
  output?: unknown;
  tests?: AutomationTest[];
  /** Free metadata; ignored — the canvas lays out every automation from its
   * references. */
  ui?: Record<string, unknown>;
}

/** Where in the document an issue is. */
export interface IssueLocation {
  /** RFC 6901 JSON Pointer into the document; `''` is the whole document. */
  pointer: string;
  /** UTF-16 [start, end) inside the STRING at `pointer` (templates,
   * conditions, code). */
  range?: [number, number];
  /**
   * What at `pointer` is meant: its value (the default), its member name
   * (an unknown field), or a member that should exist and does not (a
   * required field, a missing output) — then only the parent resolves.
   */
  subject?: 'value' | 'key' | 'missing';
}

export type IssueParamValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

/** The facts an issue's sentence is built from, by name — what a localized
 * rendering interpolates instead of parsing the English message. */
export type IssueParams = Readonly<Record<string, IssueParamValue>>;

/** Another place an issue involves: the node it reads, the node it pairs
 * with, a member of a cycle. */
export interface RelatedLocation {
  role: 'source' | 'cause' | 'partner' | 'reader' | 'cycle';
  nodeId?: string;
  at: IssueLocation;
}

/**
 * Validation issue. Error text is public API and golden-tested: agents parse
 * it behaviorally, so every issue carries a machine-readable code and,
 * wherever possible, an actionable hint — errors are the author's primary
 * feedback signal, and hints double as catalog discovery.
 *
 * `at` and `params` are the structured twin of `message`: the engine sets
 * both on every issue it emits, so an editor can point at the exact field
 * and range and a localized surface never reads the English text.
 */
export interface Issue {
  level: 'error' | 'warning';
  code: string;
  nodeId?: string;
  /** Legacy location, in three dialects (`nodes[0].id`, `/units`, `model`) —
   * kept for compatibility; new readers use `at`. */
  path?: string;
  message: string;
  hint?: string;
  at?: IssueLocation;
  params?: IssueParams;
  related?: readonly RelatedLocation[];
}

export type NodeStatus = 'ok' | 'skipped' | 'error' | 'not_run';

/** Per-node runtime record — authors read these to learn real data shapes. */
export interface NodeTrace {
  node: string;
  type: string;
  status: NodeStatus;
  execId?: string;
  /** Resolved input after template evaluation. */
  input?: unknown;
  output?: unknown;
  note?: string;
  error?: string;
  ms?: number;
  /** How a bench stood in for the node, when one did. */
  bench?: BenchMark;
  /** Run alone on pinned data (`only`), the node ran although its `when`
   * read false. */
  whenWouldSkip?: true;
}

/** An external side effect (message sent, record written, model called…) in
 * execution order. */
export interface Effect {
  node: string;
  connector: string;
  input: unknown;
  /** The item of a `forEach` step, and the pass of a `repeatUntil` step,
   * the call was made for; absent for a step that does not iterate. */
  item?: number;
  pass?: number;
}

/** Where in a step an effect happened: its item and pass, when it iterates. */
export function effectPlace(unit: {
  item: number;
  pass: number;
}): Pick<Effect, 'item' | 'pass'> {
  return {
    ...(unit.item >= 0 && { item: unit.item }),
    ...(unit.pass >= 0 && { pass: unit.pass }),
  };
}

/** A nested effect's own place, kept as its calling step folds it in. */
export function nestedEffectPlace(
  effect: Pick<Effect, 'item' | 'pass'>,
): Pick<Effect, 'item' | 'pass'> {
  return {
    ...(effect.item !== undefined && { item: effect.item }),
    ...(effect.pass !== undefined && { pass: effect.pass }),
  };
}

export interface RunError {
  nodeId?: string;
  message: string;
  hint?: string;
  /** Why the step — or the document output — failed, as a reason a reader
   * explains in their own language; absent for a run refused before its
   * steps (its input) or stopped between them. */
  failure?: StepFailure;
}

export interface RunResult {
  status: 'success' | 'error' | 'invalid';
  output?: unknown;
  error?: RunError;
  trace: NodeTrace[];
  effects: Effect[];
  validation?: { errors: Issue[]; warnings: Issue[] };
  /** What the run did at each unit of work, when the caller passed a
   * recorder that keeps one (`ExecuteOptions.recorder`). */
  record?: NodeRunRecord[];
  /** A step test's scope: the run's output is this node's (this item's)
   * output, and the document output was not evaluated. */
  focus?: { node: string; kind: 'upTo' | 'only'; item?: number };
  /** The run stopped between steps: it ran out of time, or its caller
   * cancelled it. */
  stoppedBy?: 'time_limit' | 'cancelled';
  /** Nodes the bench stood in for that the run skipped or left out. */
  unusedMocks?: string[];
}
