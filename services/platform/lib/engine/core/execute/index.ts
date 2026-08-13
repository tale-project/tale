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
 */

import { Ajv } from 'ajv';

import type { AgentTurnRequest, ConnectorHostCapabilities } from '../slots';
import { agentService, llmService, nodeTypes, storeAdapter } from '../slots';
import { evalCondition, evalTemplates, ExprError, runCode } from '../template';
import type { Automation, Effect, NodeTrace, RunResult } from '../types';
import { refsOf, topoSort } from './controlflow';
import {
  cloneData,
  makeScope,
  mockAgentText,
  mockLlmText,
  newRunId,
  stubFromSchema,
} from './scope';

const ajv = new Ajv({ allErrors: true, strict: false });

/** A resolved template destined for prompt text: strings pass through,
 * structured values render as JSON (never "[object Object]"), and absent
 * values become empty text. */
function asPromptText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

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
  /** Transform-code timeout override. */
  timeoutMs?: number;
  /** Guard against runaway documents: total node EXECUTIONS including
   * forEach items (default 100). */
  maxNodes?: number;
  /** Subautomation nesting depth (internal; hosts leave it unset). */
  nesting?: number;
}

const MAX_SUBAUTOMATION_DEPTH = 3;
const DEFAULT_MAX_REPEATS = 5;
const REPEATS_HARD_CAP = 20;
const DEFAULT_MAX_NODE_EXECUTIONS = 100;

export async function execute(
  doc: Automation,
  opts: ExecuteOptions = {},
): Promise<RunResult> {
  const input = opts.input;
  const trace: NodeTrace[] = [];
  const effects: Effect[] = [];
  const fail = (error: RunResult['error']): RunResult => ({
    status: 'error',
    error,
    trace,
    effects,
  });

  // Runtime input contract. An unparseable inputs schema is validation's
  // finding, not a run failure — skip the check rather than crash here.
  if (doc.inputs) {
    try {
      const check = ajv.compile(cloneData(doc.inputs));
      if (!check(input)) {
        const msg = (check.errors ?? [])
          .map((e) => `input${e.instancePath} ${e.message}`)
          .join('; ');
        return fail({
          message: `run input does not match the automation "inputs" schema: ${msg}`,
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

  const ordered = topoSort(doc.nodes);
  if (!ordered) {
    return fail({
      message: 'circular reference between nodes (see validate_automation)',
    });
  }

  const nodeOutputs: Record<string, { output: unknown }> = {};
  const skipped = new Set<string>();
  const whenSkipped = new Set<string>();
  const runId = newRunId();
  const maxExecutions = opts.maxNodes ?? DEFAULT_MAX_NODE_EXECUTIONS;
  let executions = 0;

  for (const n of ordered) {
    const def = nodeTypes().get(n.type);
    const t0 = performance.now();
    const entry: NodeTrace = { node: n.id, type: n.type, status: 'ok' };
    trace.push(entry);
    const finish = () => {
      entry.ms = Math.round((performance.now() - t0) * 10) / 10;
    };
    const markSkipped = (note: string) => {
      entry.status = 'skipped';
      entry.note = note;
      skipped.add(n.id);
      nodeOutputs[n.id] = { output: null };
      finish();
    };

    try {
      if (!def) throw new ExprError(n.type, `unknown node type "${n.type}"`);

      // Skip propagation from upstream DATA dependencies.
      const upstream = [...refsOf(n).data].filter((r) => skipped.has(r));
      if (upstream.length > 0) {
        markSkipped(
          `skipped: reads from skipped node(s) ${upstream.join(', ')}`,
        );
        continue;
      }

      // elseOf: run exactly when the partner was when-skipped.
      if (typeof n.elseOf === 'string' && !whenSkipped.has(n.elseOf)) {
        markSkipped(`skipped: elseOf partner "${n.elseOf}" ran`);
        continue;
      }

      if (typeof n.when === 'string') {
        const cond = await evalCondition(n.when, makeScope(input, nodeOutputs));
        if (!cond) {
          whenSkipped.add(n.id);
          markSkipped(`skipped: when=${JSON.stringify(n.when)} was falsy`);
          continue;
        }
      }

      const connectorCheck = def.connector
        ? ajv.compile(cloneData(def.connector.inputSchema))
        : null;

      /** Run the node's behavior once for one scope (per item under
       * forEach). */
      const runOnce = async (
        extra: Record<string, unknown>,
        record: boolean,
      ): Promise<unknown> => {
        executions++;
        if (executions > maxExecutions) {
          throw new ExprError(
            n.id,
            `run exceeded the ${maxExecutions}-execution guard — a forEach over a huge array or a runaway repeat; split the automation or raise maxNodes deliberately`,
          );
        }
        const scope = () => makeScope(input, nodeOutputs, extra);
        let out: unknown;

        if (n.type === 'transform') {
          const resolved = await evalTemplates(n.input ?? {}, scope());
          if (record) entry.input = resolved;
          out = await runCode(
            n.code ?? '',
            {
              input: resolved,
              nodes: scope().nodes,
              item: extra.item,
              index: extra.index,
            },
            opts.timeoutMs,
          );
          if (out === undefined || out === null) {
            throw new ExprError(
              '[code]',
              'transform code returned nothing — it must return a value',
            );
          }
        } else if (n.type === 'llm') {
          const model = n.model ?? '';
          const prompt = asPromptText(
            await evalTemplates(n.prompt ?? '', scope()),
          );
          const system = n.system
            ? asPromptText(await evalTemplates(n.system, scope()))
            : undefined;
          const llmInput = {
            model,
            prompt,
            ...(system !== undefined && { system }),
          };
          if (record) entry.input = llmInput;
          const service = llmService();
          if (opts.mode === 'live' && service) {
            const reply = await service({
              model,
              prompt,
              ...(system !== undefined && { system }),
              ...(n.outputSchema !== undefined && {
                outputSchema: n.outputSchema,
              }),
            });
            if (n.outputSchema !== undefined) {
              if ('data' in reply) {
                out = reply.data;
              } else {
                throw new ExprError(
                  n.id,
                  'the llm service returned plain text for a node with outputSchema — structured output was required',
                );
              }
            } else {
              out = 'text' in reply ? { text: reply.text } : reply.data;
            }
          } else {
            if (record && opts.mode === 'live' && !service) {
              entry.note = 'no llm service installed — deterministic mock used';
            }
            out =
              n.outputSchema !== undefined
                ? stubFromSchema(n.outputSchema)
                : { text: mockLlmText(model, prompt) };
          }
          effects.push({ node: n.id, connector: 'llm', input: llmInput });
        } else if (n.type === 'agent') {
          const model = n.model ?? '';
          const prompt = asPromptText(
            await evalTemplates(n.prompt ?? '', scope()),
          );
          const system = n.system
            ? asPromptText(await evalTemplates(n.system, scope()))
            : undefined;
          const files =
            n.files === undefined
              ? undefined
              : // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- evalTemplates preserves the record shape of `files`
                ((await evalTemplates(n.files, scope())) as Record<
                  string,
                  unknown
                >);
          const context =
            n.input === undefined
              ? undefined
              : await evalTemplates(n.input, scope());
          const agentInput: AgentTurnRequest = {
            model,
            prompt,
            ...(system !== undefined && { system }),
            ...(n.harness !== undefined && { harness: n.harness }),
            ...(n.skills !== undefined && { skills: n.skills }),
            ...(n.connectors !== undefined && { connectors: n.connectors }),
            ...(n.tools !== undefined && { tools: n.tools }),
            ...(n.secrets !== undefined && { secrets: n.secrets }),
            ...(files !== undefined && { files }),
            ...(context !== undefined && { input: context }),
          };
          if (record) entry.input = agentInput;
          const service = agentService();
          if (opts.mode === 'live' && service) {
            const reply = await service(agentInput);
            out = {
              text: reply.text,
              files: reply.files ?? [],
              status: reply.status ?? 'ok',
            };
          } else {
            if (record && opts.mode === 'live' && !service) {
              entry.note =
                'no agent service installed — deterministic mock used';
            }
            out = {
              text: mockAgentText(model, prompt),
              files: [],
              status: 'ok',
            };
          }
          effects.push({ node: n.id, connector: 'agent', input: agentInput });
        } else if (n.type === 'subautomation') {
          const ref = n.automation ?? '';
          const store = storeAdapter();
          if (!store) {
            throw new ExprError(
              'subautomation',
              'no automation store is configured in this environment',
            );
          }
          const [subName, subVerRaw] = ref.split('@');
          const subVer = subVerRaw
            ? Number(subVerRaw)
            : ((await store.deployedVersion(subName)) ?? undefined);
          const found = await store.get(subName, subVer);
          if (!found) {
            throw new ExprError(
              'subautomation',
              `no saved automation "${ref}" — save_automation it first`,
            );
          }
          const depth = opts.nesting ?? 0;
          if (depth >= MAX_SUBAUTOMATION_DEPTH) {
            throw new ExprError(
              'subautomation',
              `subautomations nest at most ${MAX_SUBAUTOMATION_DEPTH} levels deep`,
            );
          }
          const resolved = await evalTemplates(n.input ?? {}, scope());
          if (record) entry.input = { automation: ref, input: resolved };
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- store contents were validated at save time
          const sub = await execute(found.automation as Automation, {
            ...opts,
            input: resolved,
            nesting: depth + 1,
          });
          if (sub.status !== 'success') {
            throw new ExprError(
              'subautomation',
              `subautomation "${ref}" ${sub.status}: ${sub.error?.message ?? 'see its validation errors'}`,
            );
          }
          for (const ef of sub.effects) {
            effects.push({
              node: `${n.id}/${ef.node}`,
              connector: ef.connector,
              input: ef.input,
            });
          }
          out = sub.output;
        } else if (def.connector && connectorCheck) {
          const resolved = await evalTemplates(n.input ?? {}, scope());
          if (record) entry.input = resolved;
          if (!connectorCheck(resolved)) {
            const msg = (connectorCheck.errors ?? [])
              .map((e) => `input${e.instancePath} ${e.message}`)
              .join('; ');
            throw new ExprError(
              n.type,
              `resolved input does not match the ${n.type} schema: ${msg}. Resolved input was: ${JSON.stringify(resolved)}`,
            );
          }
          const host = opts.connectorHost?.(def.connector.name);
          if (opts.mode === 'live' && def.connector.live && host) {
            const secretMap = opts.secrets?.[def.connector.name] ?? {};
            try {
              out = await def.connector.live(resolved, {
                secrets: {
                  get: (name: string) => secretMap[name] ?? '',
                },
                idempotencyKey: `${runId}:${n.id}:${Number(extra.index ?? 0)}`,
                endpoint: host.endpoint,
                config: host.config,
                http: host.http,
                files: host.files,
                base64Encode: host.base64Encode,
                base64Decode: host.base64Decode,
              });
            } catch (e) {
              throw new ExprError(
                n.type,
                `live call failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`,
              );
            }
          } else {
            if (opts.mode === 'live' && record) {
              entry.note = def.connector.live
                ? 'no connector host supplied — deterministic mock used'
                : 'live backend not implemented — deterministic mock used';
            }
            out = await def.connector.mock(resolved);
          }
          if (def.connector.hasEffect) {
            effects.push({ node: n.id, connector: n.type, input: resolved });
          }
        } else {
          throw new ExprError(
            n.type,
            `node type "${n.type}" is not executable`,
          );
        }
        return out;
      };

      /** Apply repeatUntil around a single runOnce invocation. */
      const runWithRepeat = async (
        extra: Record<string, unknown>,
        record: boolean,
      ): Promise<unknown> => {
        if (typeof n.repeatUntil !== 'string') return runOnce(extra, record);
        const max = Math.min(
          n.maxRepeats ?? DEFAULT_MAX_REPEATS,
          REPEATS_HARD_CAP,
        );
        let out: unknown;
        let iters = 0;
        let done = false;
        for (; iters < max; iters++) {
          out = await runOnce(extra, record && iters === 0);
          // The in-flight result is visible BOTH as `output` and as this
          // node's own nodes.<id>.output — authors naturally write either.
          const withSelf = { ...nodeOutputs, [n.id]: { output: out } };
          const cond = await evalCondition(
            n.repeatUntil,
            makeScope(input, withSelf, { ...extra, output: out }),
          );
          if (cond) {
            done = true;
            iters++;
            break;
          }
        }
        if (record) {
          entry.note = `repeatUntil ran ${iters}x${done ? '' : ' (maxRepeats hit before the condition became true)'}`;
        }
        return out;
      };

      let output: unknown;
      if (typeof n.forEach === 'string') {
        const arr = await evalTemplates(
          n.forEach,
          makeScope(input, nodeOutputs),
        );
        if (!Array.isArray(arr)) {
          throw new ExprError(
            n.forEach,
            `forEach must resolve to an array, got ${arr === undefined ? 'undefined' : typeof arr} — check the referenced path`,
          );
        }
        entry.input = { forEach: `${arr.length} item(s)` };
        const outs: unknown[] = [];
        for (const [index, item] of arr.entries()) {
          outs.push(await runWithRepeat({ item, index }, false));
        }
        output = outs;
      } else {
        output = await runWithRepeat({}, true);
      }

      entry.output = output;
      nodeOutputs[n.id] = { output };
      finish();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      entry.status = 'error';
      entry.error = message;
      finish();
      if (n.onError === 'continue') {
        entry.note = 'onError: continue — dependents are skipped';
        skipped.add(n.id);
        nodeOutputs[n.id] = { output: null };
        continue;
      }
      for (const rest of ordered.slice(ordered.indexOf(n) + 1)) {
        trace.push({ node: rest.id, type: rest.type, status: 'not_run' });
      }
      const hint = /is not defined/.test(message)
        ? 'in templates and code, only `input` and `nodes.<id>.output` are available'
        : /Cannot read propert/.test(message)
          ? 'a referenced value is null/undefined — check the exact output shape in the trace of the upstream node'
          : undefined;
      return fail({ nodeId: n.id, message, ...(hint && { hint }) });
    }
  }

  try {
    const output =
      doc.output !== undefined
        ? await evalTemplates(
            cloneData(doc.output),
            makeScope(input, nodeOutputs),
          )
        : null;
    return { status: 'success', output, trace, effects };
  } catch (e) {
    return fail({
      message: `failed to evaluate automation "output": ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
