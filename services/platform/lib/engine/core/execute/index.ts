/**
 * The executor: run a validated automation against an input, producing
 * `{status, output, trace, effects}`.
 *
 * The trace records every node's RESOLVED input and actual output — it is
 * the author's runtime feedback, and together with the effects log it is
 * what the fast feedback loop is made of. Modes: `mock` (default) runs
 * deterministic connector/llm mocks so runs are repeatable and acceptance
 * tests can compute expected values; `live` calls connector.live() and the
 * installed LlmService (host-gated upstream).
 *
 * The steps are walked by `./walker`; this is its in-process host: it checks
 * the run's input, hands the walk its ports, and evaluates the output.
 */

import { classifyStepFailure } from '../record/failure';
import { noRecorder, type RunRecorder } from '../record/recorder';
import { END_PATH, START_PATH, type UnitKey } from '../record/types';
import type { ConnectorHostCapabilities, StoreAdapter } from '../slots';
import { agentService, llmService } from '../slots';
import { ptr } from '../syntax/pointer';
import { evalTemplates, explainFailure, runCode } from '../template';
import type {
  Automation,
  Effect,
  Issue,
  NodeTrace,
  RunBench,
  RunResult,
} from '../types';
import { compileSchema, inputRefusalMessage } from '../validate/schema';
import { DEFAULT_MAX_NODE_EXECUTIONS } from '../walk/limits';
import { systemClock, type WalkPorts } from '../walk/ports';
import { type BenchPlan, planBench, refusalIssue, refusalPath } from './bench';
import { cloneData, makeScope, newRunId } from './scope';
import { walkSteps } from './walker';

export interface ExecuteOptions {
  /** The runtime input, validated against the automation's `inputs` schema. */
  input?: unknown;
  /** `mock` (default): deterministic mocks. `live`: real side effects. */
  mode?: 'mock' | 'live';
  /** Per-connector secret maps, handed to live() calls only. */
  secrets?: Record<string, Record<string, string>>;
  /**
   * The mediated capabilities a live connector call may reach — HTTP,
   * blob storage, base64, and the per-credential endpoint. The engine never
   * implements these: the host supplies them so it can enforce the host
   * allowlist, inject credentials, and account for the work. Absent in mock
   * mode, and its absence is why a live run without a host falls back to the
   * deterministic mock rather than reaching the network.
   */
  connectorHost?: (connector: string) => ConnectorHostCapabilities;
  /**
   * Where `subautomation` nodes resolve the documents they reference. Threaded
   * per call — never a process-global slot — because a store is scoped to one
   * organization while one process serves many. Without it a subautomation
   * node fails with guidance instead of reading another tenant's store.
   */
  store?: StoreAdapter;
  /** Transform-code timeout override. */
  timeoutMs?: number;
  /** Guard against runaway documents: total node EXECUTIONS including
   * forEach items (default 100). */
  maxNodes?: number;
  /** Subautomation nesting depth (internal; hosts leave it unset). */
  nesting?: number;
  /** The calling run and the path prefix of a subautomation's own nodes
   * (internal; hosts leave it unset): a nested call presents the key the
   * durable stepper gives the same call, `<run>:<parent>[<item>:<pass>]/<id>:…`.
   * `docRef` names the document the nested nodes come from (`name@version`). */
  within?: { runId: string; pathPrefix: string; docRef?: string };
  /**
   * Where the run's record goes: what each unit of work decided, read,
   * received and returned. Without one the run executes exactly as before
   * and its result carries no record; with one, the result's `record` holds
   * every unit the recorder kept.
   */
  recorder?: RunRecorder;
  /**
   * What stands in for some nodes' calls, and the narrower scope of a step
   * test (`./bench`): a test's simulated outputs and failures, the
   * scenarios it picks, `upTo`, `only` with its pinned data, `item`. Mock runs only — a live run with a
   * bench is refused — and the automation's own nodes only: a called
   * automation runs as written.
   */
  bench?: RunBench;
  /** Epoch ms: past it the run stops at its next step, item or pass. */
  deadline?: number;
  /** Once aborted, the run stops at its next step, item or pass. */
  signal?: AbortSignal;
}

/** A run that is refused before any step: an invalid bench. */
function refusedRun(issue: Issue): RunResult {
  return {
    status: 'invalid',
    trace: [],
    effects: [],
    validation: { errors: [issue], warnings: [] },
  };
}

/** The ports of a walk in this process: transform code in the sandbox,
 * the installed model and agent services, the connector host and secrets the
 * caller hands over, the caller's store, and the system clock. */
function inProcessPorts(opts: ExecuteOptions): WalkPorts {
  const store = opts.store;
  return {
    calls: {
      transform: (code, context, pointer) =>
        runCode(code, context, opts.timeoutMs, pointer),
      llm: () => llmService(),
      connector: (connector) => {
        const host = opts.connectorHost?.(connector.name);
        if (!connector.live || !host) return null;
        const live = connector.live.bind(connector);
        return (input, idempotencyKey) => {
          const secretMap = opts.secrets?.[connector.name] ?? {};
          return live(input, {
            secrets: {
              get: (name: string) => secretMap[name] ?? '',
            },
            idempotencyKey,
            endpoint: host.endpoint,
            config: host.config,
            http: host.http,
            files: host.files,
            base64Encode: host.base64Encode,
            base64Decode: host.base64Decode,
          });
        };
      },
    },
    agent: { service: () => agentService() },
    ...(store && {
      loader: {
        load: async (name, version) => {
          const found = await store.get(
            name,
            version ?? (await store.deployedVersion(name)) ?? undefined,
          );
          if (!found) return null;
          return {
            name,
            version: found.meta.version,
            automation: found.automation,
          };
        },
      },
    }),
    clock: systemClock,
  };
}

export async function execute(
  doc: Automation,
  opts: ExecuteOptions = {},
): Promise<RunResult> {
  const input = opts.input;
  const trace: NodeTrace[] = [];
  const effects: Effect[] = [];
  const rec = opts.recorder ?? noRecorder;
  // A nested run records into its caller's recorder; only the outermost run
  // records the run's own input and output, and answers the record.
  const outermost = opts.within === undefined;

  // The bench stands in for the automation's own nodes only: a called
  // automation runs as written, and its stand-in, if any, replaces it whole.
  let plan: BenchPlan | undefined;
  if (outermost && opts.bench !== undefined) {
    if (opts.mode === 'live') {
      return refusedRun({
        level: 'error',
        code: 'BENCH_MOCK_ONLY',
        message:
          'simulated outputs, simulated failures, picked scenarios and narrower scopes apply to mock runs only',
        hint: 'run in mock mode — a live run calls every node as written',
        at: { pointer: '/bench' },
        params: {},
      });
    }
    const planned = planBench(doc.nodes, opts.bench);
    if (!planned.ok) {
      return refusedRun(
        refusalIssue(planned, ptr('bench', ...refusalPath(planned.refusal))),
      );
    }
    plan = planned.plan;
  }

  /** The nodes whose stand-in took the place of a call, or whose pinned
   * data a step test used. */
  const used = new Set<string>();
  /** What a run with a bench says beside its outcome: its scope, and the
   * stand-ins it never used — their node was skipped, left out or never
   * got to, or ran over no items. */
  const benchFacts = (): Pick<RunResult, 'focus' | 'unusedMocks'> => {
    if (plan === undefined) return {};
    const unused = plan.standIns.filter((id) => !used.has(id));
    return {
      ...(plan.focus !== undefined && { focus: plan.focus }),
      ...(unused.length > 0 && { unusedMocks: unused }),
    };
  };
  const withRecord = (result: RunResult): RunResult => {
    const told = { ...result, ...benchFacts() };
    return outermost && opts.recorder !== undefined
      ? { ...told, record: rec.snapshot() }
      : told;
  };
  const fail = (error: RunResult['error']): RunResult =>
    withRecord({
      status: 'error',
      error,
      trace,
      effects,
    });

  const ports = inProcessPorts(opts);
  const startedAt = ports.clock.now();

  if (outermost) {
    const startKey = { path: START_PATH, item: -1, pass: -1 };
    rec.unitStarted(startKey, { nodeId: START_PATH, nodeType: 'input' });
    rec.unitFinished(startKey, { status: 'ok', output: input });
  }

  // Runtime input contract. An unparseable inputs schema is validation's
  // finding, not a run failure — skip the check rather than crash here.
  // compileSchema clears the Ajv cache per compile, so a long-lived process
  // does not retain one validator per run and an `$id` compiles every time.
  if (doc.inputs) {
    try {
      const check = compileSchema(doc.inputs);
      if (!check(input)) {
        return fail({
          message: inputRefusalMessage(check.errors),
          hint: `you passed: ${JSON.stringify(input)}`,
        });
      }
    } catch (err) {
      console.warn(
        '[engine] skipping run-input check (unparseable inputs schema — validate_automation reports it):',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const outcome = await walkSteps({
    doc,
    input,
    mode: opts.mode,
    ports,
    rec,
    trace,
    effects,
    runId: opts.within?.runId ?? newRunId(),
    pathPrefix: opts.within?.pathPrefix ?? '',
    docRef: opts.within?.docRef,
    nesting: opts.nesting ?? 0,
    maxExecutions: opts.maxNodes ?? DEFAULT_MAX_NODE_EXECUTIONS,
    startedAt,
    deadline: opts.deadline,
    signal: opts.signal,
    plan,
    used,
    runCalled: (automation, run) =>
      execute(automation, {
        ...opts,
        input: run.input,
        nesting: run.nesting,
        within: run.within,
      }),
  });
  if (outcome.kind === 'refused') return refusedRun(outcome.issue);
  if (outcome.kind === 'failed') return fail(outcome.error);
  if (outcome.kind === 'stopped') {
    return { ...fail(outcome.error), stoppedBy: outcome.by };
  }
  const nodeOutputs = outcome.outputs;

  const focus = plan?.focus;

  if (focus !== undefined) {
    // A step test's run answers its node's output; the document output is
    // not evaluated, so it has no record either.
    return withRecord({
      status: 'success',
      output: nodeOutputs[focus.node]?.output ?? null,
      trace,
      effects,
    });
  }

  const endKey: UnitKey = { path: END_PATH, item: -1, pass: -1 };
  if (outermost) {
    rec.unitStarted(endKey, { nodeId: END_PATH, nodeType: 'output' });
  }
  try {
    const output =
      doc.output !== undefined
        ? await evalTemplates(
            cloneData(doc.output),
            makeScope(input, nodeOutputs),
            '/output',
          )
        : null;
    if (outermost) rec.unitFinished(endKey, { status: 'ok', output });
    return withRecord({ status: 'success', output, trace, effects });
  } catch (e) {
    const message = `failed to evaluate automation "output": ${e instanceof Error ? e.message : String(e)}`;
    if (outermost && rec.enabled) {
      await explainFailure(e, makeScope(input, nodeOutputs));
    }
    const failure = classifyStepFailure(e, {
      code: 'node_error',
      message,
      pointer: '/output',
    });
    if (outermost) rec.unitFinished(endKey, { status: 'failed', failure });
    return fail({ message, failure });
  }
}
