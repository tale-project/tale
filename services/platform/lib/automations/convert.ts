/**
 * Converting an org's step-graph automation into a v1 automation document.
 *
 * Automations authored against the imperative step runner are a graph of
 * steps that name their own successors (`nextSteps`), with dedicated
 * `condition` and `loop` step types and expressions in a filter language. A v1
 * document has none of that: nodes carry declarative control flow
 * (`when` / `elseOf` / `forEach` / `repeatUntil`), and execution ORDER is
 * derived from `{{ nodes.<id>.output }}` references — there is no edge list to
 * translate into.
 *
 * So the conversion is a re-expression, not a re-serialization:
 *
 *  - each successor link becomes either a data reference (the successor
 *    already reads the step's result) or an ordering reference in the
 *    successor's `when` — the engine orders on references, so ordering is
 *    said in the one place the engine reads;
 *  - a condition step disappears into the `when` of the nodes it guarded, and
 *    its two branches pair up as `when` / `elseOf` wherever the branch heads
 *    are a true exclusive either-or;
 *  - a loop step disappears into `forEach` on the node(s) it iterated, and a
 *    single-node polling cycle becomes `repeatUntil` + `maxRepeats`.
 *
 * Everything that CANNOT be re-expressed with the same behaviour is reported
 * in `needsReview` and left visible in the document rather than quietly
 * rewritten: a per-item branch inside a multi-step loop body, a capability the
 * engine has no node for, a transform whose result cannot be reproduced. The
 * caller marks such an automation for review. A wrong silent translation is
 * far worse than a flagged one, because a flagged one is never mistaken for
 * working.
 *
 * Two things are dropped on purpose rather than reported, because neither is
 * behaviour: a step's display text (a document has no per-node label — the
 * node id keeps the step's slug, and the automation's own text lives in its
 * manifest), and a step's retry policy (retries are the runtime's concern, not
 * the document's).
 *
 * The function is pure — no filesystem, no database, no registry lookups
 * beyond an optional set of known node types — so it can be unit-tested
 * against a corpus and reused by whatever writes the converted documents.
 */

import type { NodeDef, Automation } from '../engine/core/types';
import { isRecord } from '../utils/type-utils';
import type { ExpressionScope, StepOutputKind } from './expression';
import {
  translateExpression,
  translateTemplate,
  translateValue,
} from './expression';

// ------------------------------------------------------------- source shapes

/** One step of a source automation. */
export interface SourceStep {
  readonly stepSlug: string;
  readonly name?: string;
  readonly description?: string;
  readonly stepType: string;
  readonly config?: Record<string, unknown>;
  /** Port name → the slug that runs next (`success`, `true`/`false`,
   * `loop`/`done`). */
  readonly nextSteps?: Record<string, string>;
}

/** What the converter reads: a step-graph automation as it was authored — its
 * steps plus its declared constants. */
export interface SourceAutomation {
  readonly config?: { readonly variables?: Record<string, unknown> };
  readonly steps: readonly SourceStep[];
}

export interface ConvertOptions {
  /** Document name (kebab-case identity of the automation). */
  readonly name: string;
  readonly description?: string;
  /**
   * The model an `llm` node calls when the source step named none. The engine
   * never picks a model, so the conversion must name one — and says so in
   * `needsReview` every time it had to.
   */
  readonly model: string;
  /** Registered node types, when the caller can supply them: an action with
   * no registered capability is reported instead of shipped. */
  readonly knownTypes?: ReadonlySet<string>;
}

/** One construct that could not be converted faithfully. `node` is the id of
 * the node it concerns, or the source step slug when no node was emitted. */
export interface ReviewNote {
  readonly node: string;
  readonly reason: string;
}

export interface Conversion {
  readonly automation: Automation;
  /** Empty means the document is a faithful conversion. */
  readonly needsReview: ReviewNote[];
}

// --------------------------------------------------------------- step naming

const MAX_ID_LENGTH = 50;

/** A node id the engine accepts: `^[a-z][a-z0-9_]{0,49}$`. */
function toNodeId(slug: string, taken: ReadonlySet<string>): string {
  const base =
    slug
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replaceAll(/_+/g, '_')
      .replace(/_$/, '')
      .slice(0, MAX_ID_LENGTH) || 'step';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_ID_LENGTH - String(n).length - 1)}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** An automation name the engine accepts: `^[a-z0-9][a-z0-9-]{0,63}$`. */
export function toAutomationName(slug: string): string {
  const name =
    slug
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/-+/g, '-')
      .replace(/^-/, '')
      .replace(/-$/, '')
      .slice(0, 64) || 'automation';
  return /^[a-z0-9]/.test(name) ? name : `a-${name}`.slice(0, 64);
}

// ------------------------------------------------------------------ planning

type StepRole = 'start' | 'output' | 'condition' | 'loop' | 'node' | 'unknown';
type NodeKind = 'integration' | 'variables' | 'llm' | 'placeholder';

interface StepPlan {
  readonly step: SourceStep;
  readonly role: StepRole;
  readonly nodeKind?: NodeKind;
  readonly nodeId?: string;
  readonly outputKind: StepOutputKind;
  /** `<capability>.<operation>` for an action, for messages and node types. */
  readonly capability?: string;
}

interface GuardTerm {
  readonly conditionSlug: string;
  readonly negated: boolean;
  /** True when the condition reads the item of the loop it sits in, which a
   * node-level `when` cannot see. */
  readonly perItem: boolean;
}

type Guard = readonly GuardTerm[];

interface LoopContext {
  readonly slug: string;
  readonly items: string;
  readonly itemVariable?: string;
  readonly continueOnError: boolean;
  readonly bodySlugs: Set<string>;
}

interface Placement {
  guards: Guard[];
  loop?: LoopContext;
  readonly predecessors: Set<string>;
  readonly order: number;
}

function stringField(config: unknown, key: string): string | undefined {
  if (!isRecord(config)) return undefined;
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function recordField(
  config: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!isRecord(config)) return undefined;
  const value = config[key];
  return isRecord(value) ? value : undefined;
}

/** The capability an action step invoked, e.g. `github.list_issues` or
 * `task.upsert_external`. */
function capabilityOf(step: SourceStep): string {
  const type = stringField(step.config, 'type') ?? 'action';
  const parameters = recordField(step.config, 'parameters') ?? {};
  const operation =
    typeof parameters.operation === 'string' ? parameters.operation : undefined;
  if (type === 'integration') {
    const connector =
      typeof parameters.name === 'string' ? parameters.name : 'integration';
    return `${connector.replaceAll('_', '-')}.${operation ?? 'call'}`;
  }
  return operation === undefined ? type : `${type}.${operation}`;
}

function planStep(step: SourceStep, taken: Set<string>): StepPlan {
  const withId = (
    kind: NodeKind,
    outputKind: StepOutputKind,
    capability = capabilityOf(step),
  ): StepPlan => {
    const nodeId = toNodeId(step.stepSlug, taken);
    taken.add(nodeId);
    return {
      step,
      role: 'node',
      nodeKind: kind,
      nodeId,
      outputKind,
      capability,
    };
  };
  switch (step.stepType) {
    case 'start':
    case 'trigger':
      return { step, role: 'start', outputKind: 'unknown' };
    case 'output':
      return { step, role: 'output', outputKind: 'unknown' };
    case 'condition':
      return { step, role: 'condition', outputKind: 'unknown' };
    case 'loop':
      return { step, role: 'loop', outputKind: 'unknown' };
    case 'llm':
      return withId(
        'llm',
        recordField(step.config, 'outputSchema') === undefined
          ? 'llm-text'
          : 'llm-json',
      );
    case 'action': {
      const type = stringField(step.config, 'type');
      if (type === 'integration') return withId('integration', 'integration');
      if (type === 'set_variables') return withId('variables', 'data');
      return withId('placeholder', 'unknown');
    }
    default:
      // A step kind of its own (a sandbox run, say) — named by that kind.
      return withId('placeholder', 'unknown', step.stepType);
  }
}

/** Iteration cap for a converted repeat: the engine's own default, named here
 * because a converted repeat had no cap at all and one has to be chosen. */
const DEFAULT_REPEATS = 5;

/** The node-count ceiling a document may hold. */
const MAX_NODES = 40;

// ----------------------------------------------------------------- traversal

/** Ports a condition step routes on. */
const TRUE_PORT = 'true';
const FALSE_PORT = 'false';

function guardKey(guard: Guard): string {
  return guard
    .map((term) => `${term.conditionSlug}:${term.negated ? '0' : '1'}`)
    .join('|');
}

/** Whether an expression reads the current loop item. The item's own name
 * comes from the source document, so it is escaped before it becomes part of
 * a pattern. */
function readsItem(expression: string, itemVariable?: string): boolean {
  if (/\bloop\s*\.\s*(?:item|index)\b/.test(expression)) return true;
  if (/(?<![.\w$])(?:item|index)\b/.test(expression)) return true;
  if (itemVariable === undefined) return false;
  const name = itemVariable.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?<![.\w$])${name}\b`).test(expression);
}

// ------------------------------------------------------------------ converter

export function convertAutomation(
  source: SourceAutomation,
  options: ConvertOptions,
): Conversion {
  const notes: ReviewNote[] = [];
  const note = (node: string, reason: string): void => {
    if (!notes.some((n) => n.node === node && n.reason === reason)) {
      notes.push({ node, reason });
    }
  };

  const taken = new Set<string>();
  const constants = source.config?.variables ?? {};
  const constantNames = new Set(Object.keys(constants));
  const constantsNodeId =
    constantNames.size > 0 ? toNodeId('constants', taken) : undefined;
  if (constantsNodeId !== undefined) taken.add(constantsNodeId);

  const plans = new Map<string, StepPlan>();
  for (const step of source.steps) {
    plans.set(step.stepSlug, planStep(step, taken));
  }

  // ---- walk the graph, collecting guards, loop membership and order.

  const placements = new Map<string, Placement>();
  const visited = new Map<string, Set<string>>();
  const cycles: Array<{ from: string; to: string; guard: Guard }> = [];
  let order = 0;

  const visit = (
    slug: string,
    guard: Guard,
    loop: LoopContext | undefined,
    stack: readonly string[],
    from: string | undefined,
  ): void => {
    const plan = plans.get(slug);
    if (plan === undefined) {
      if (from !== undefined) {
        const parent = plans.get(from);
        note(
          parent?.nodeId ?? from,
          `step "${from}" continues to "${slug}", which does not exist`,
        );
      }
      return;
    }

    const placement = placements.get(slug) ?? {
      guards: [],
      loop,
      predecessors: new Set<string>(),
      order: order++,
    };
    placements.set(slug, placement);
    if (from !== undefined) placement.predecessors.add(from);

    const key = guardKey(guard);
    const seen = visited.get(slug) ?? new Set<string>();
    if (seen.has(key)) return;
    seen.add(key);
    visited.set(slug, seen);
    placement.guards.push(guard);
    if (loop !== undefined) {
      placement.loop = loop;
      if (plan.role === 'node' && plan.nodeId !== undefined) {
        loop.bodySlugs.add(slug);
      }
    }

    const next = plan.step.nextSteps ?? {};
    const branchTo = (
      target: string | undefined,
      nextGuard: Guard,
      nextLoop: LoopContext | undefined,
    ): void => {
      if (target === undefined || target === '') return;
      // A body step naming the loop again is simply "take the next item".
      if (nextLoop !== undefined && target === nextLoop.slug) return;
      if (stack.includes(target)) {
        cycles.push({ from: slug, to: target, guard: nextGuard });
        return;
      }
      visit(target, nextGuard, nextLoop, [...stack, slug], slug);
    };

    switch (plan.role) {
      case 'condition': {
        const expression = stringField(plan.step.config, 'expression');
        if (expression === undefined) {
          note(slug, `condition step "${slug}" has no expression to branch on`);
          for (const target of Object.values(next)) {
            branchTo(target, guard, loop);
          }
          return;
        }
        const perItem =
          loop !== undefined && readsItem(expression, loop.itemVariable);
        branchTo(
          next[TRUE_PORT],
          [...guard, { conditionSlug: slug, negated: false, perItem }],
          loop,
        );
        branchTo(
          next[FALSE_PORT],
          [...guard, { conditionSlug: slug, negated: true, perItem }],
          loop,
        );
        for (const [port, target] of Object.entries(next)) {
          if (port === TRUE_PORT || port === FALSE_PORT) continue;
          note(
            slug,
            `condition step "${slug}" also routes on "${port}", which has no branch meaning`,
          );
          branchTo(target, guard, loop);
        }
        return;
      }
      case 'loop': {
        const config = plan.step.config ?? {};
        const itemVariable = stringField(plan.step.config, 'itemVariable');
        // The list is usually a template; a concrete list is carried through
        // as a literal so the node still iterates exactly what it iterated.
        const items =
          typeof config.items === 'string'
            ? config.items
            : config.items === undefined
              ? ''
              : `{{ ${JSON.stringify(config.items)} }}`;
        const nested = loop !== undefined;
        const context: LoopContext = {
          slug,
          items,
          itemVariable,
          continueOnError: config.continueOnError === true,
          bodySlugs: new Set<string>(),
        };
        if (items === '') {
          note(
            slug,
            `loop step "${slug}" names no list to iterate; give the nodes it ran a forEach over the list they should walk`,
          );
        }
        if (nested) {
          note(
            slug,
            `loop step "${slug}" iterates inside another loop; nested iteration has to be re-authored as a saved automation called per item`,
          );
        }
        if (typeof config.maxIterations === 'number') {
          note(
            slug,
            `loop step "${slug}" capped itself at ${config.maxIterations} iterations; a forEach node runs once per item, so re-introduce the cap where the list is built`,
          );
        }
        branchTo(next.loop, guard, context);
        branchTo(next.done, guard, loop);
        return;
      }
      default:
        for (const target of Object.values(next)) branchTo(target, guard, loop);
    }
  };

  const startStep =
    source.steps.find((step) => plans.get(step.stepSlug)?.role === 'start') ??
    source.steps[0];
  if (startStep !== undefined) {
    visit(startStep.stepSlug, [], undefined, [], undefined);
  }
  // A trigger declared as a step is not a node: what starts a run is a
  // binding on the automation, which only the caller can create.
  if (startStep?.stepType === 'trigger') {
    note(
      startStep.stepSlug,
      `step "${startStep.stepSlug}" declared what triggers the automation; a trigger is now a binding on the automation itself, so recreate it there`,
    );
  }

  for (const step of source.steps) {
    if (!placements.has(step.stepSlug)) {
      const plan = plans.get(step.stepSlug);
      note(
        plan?.nodeId ?? step.stepSlug,
        `step "${step.stepSlug}" is never reached from the start of the graph and was dropped`,
      );
    }
  }

  // ---- the expression scope, filled in as nodes are emitted.

  const nodeIds = new Map<string, string>();
  const outputKinds = new Map<string, StepOutputKind>();
  const variables = new Map<string, string>();
  for (const [slug, plan] of plans) {
    if (plan.nodeId === undefined) continue;
    nodeIds.set(slug, plan.nodeId);
    outputKinds.set(slug, plan.outputKind);
  }

  const scopeFor = (loop: LoopContext | undefined): ExpressionScope => ({
    nodeIds,
    outputKinds,
    variables,
    constantsNodeId,
    constants: constantNames,
    iterating: loop !== undefined,
    itemVariable: loop?.itemVariable,
    perItemOutputs: loop?.bodySlugs,
  });

  const nodes: NodeDef[] = [];
  const emitted = new Map<string, NodeDef>();

  if (constantsNodeId !== undefined) {
    const { value, issues } = translateValue(constants, scopeFor(undefined));
    nodes.push({
      id: constantsNodeId,
      type: 'transform',
      input: isRecord(value) ? value : {},
      code: 'return input;',
    });
    for (const issue of issues) note(constantsNodeId, issue);
  }

  const ordered = [...placements.entries()]
    .filter(([slug]) => plans.get(slug)?.role === 'node')
    .sort((a, b) => a[1].order - b[1].order);

  /** Conditions whose expression made it into some node's guard. Whatever is
   * left over is still read for issues: a condition nobody inherited can
   * still hold something a human has to decide. */
  const guardsUsed = new Set<string>();

  /** The `when` guard of a node, minus the terms a node-level condition
   * cannot express. */
  const guardExpression = (
    plan: StepPlan,
    placement: Placement,
    scope: ExpressionScope,
  ): string | undefined => {
    const nodeId = plan.nodeId ?? plan.step.stepSlug;
    const alternatives: string[] = [];
    for (const guard of placement.guards) {
      const terms: string[] = [];
      for (const term of guard) {
        const raw = stringField(
          plans.get(term.conditionSlug)?.step.config,
          'expression',
        );
        if (raw === undefined) continue;
        guardsUsed.add(term.conditionSlug);
        if (term.perItem) {
          note(
            nodeId,
            `step "${term.conditionSlug}" decided per item (${JSON.stringify(raw)}); a node's "when" is evaluated once, so filter the list this node iterates instead`,
          );
          continue;
        }
        // A condition's own expression is evaluated once, outside iteration.
        const translated = translateExpression(raw, {
          ...scope,
          iterating: false,
        });
        for (const issue of translated.issues) note(nodeId, issue);
        terms.push(term.negated ? `!(${translated.text})` : translated.text);
      }
      if (terms.length > 0) alternatives.push(terms.join(' && '));
    }
    if (alternatives.length === 0) return undefined;
    if (alternatives.length > 1) {
      note(
        nodeId,
        'this step was reached through more than one branch; the conditions were combined with "or" — check that this is what the automation meant',
      );
      return `{{ ${alternatives.map((a) => `(${a})`).join(' || ')} }}`;
    }
    return `{{ ${alternatives[0]} }}`;
  };

  for (const [slug, placement] of ordered) {
    const plan = plans.get(slug);
    if (plan?.nodeId === undefined) continue;
    const nodeId = plan.nodeId;
    const scope = scopeFor(placement.loop);
    const node: NodeDef = { id: nodeId, type: 'transform' };

    switch (plan.nodeKind) {
      case 'integration': {
        const parameters = recordField(plan.step.config, 'parameters') ?? {};
        const type = plan.capability ?? 'integration.call';
        const { value, issues } = translateValue(
          parameters.params ?? {},
          scope,
        );
        node.type = type;
        node.input = isRecord(value) ? value : {};
        for (const issue of issues) note(nodeId, issue);
        if (parameters.params !== undefined && !isRecord(parameters.params)) {
          note(
            nodeId,
            'this step passed its call arguments as a single value rather than named fields; write them out against the action schema',
          );
        }
        if (options.knownTypes !== undefined && !options.knownTypes.has(type)) {
          note(
            nodeId,
            `no connector action named "${type}" is registered; pick the action that replaces it`,
          );
        }
        break;
      }
      case 'variables': {
        const parameters = recordField(plan.step.config, 'parameters') ?? {};
        const declared = Array.isArray(parameters.variables)
          ? parameters.variables
          : [];
        const input: Record<string, unknown> = {};
        for (const entry of declared) {
          if (!isRecord(entry) || typeof entry.name !== 'string') {
            note(nodeId, 'a variable assignment has no name and was dropped');
            continue;
          }
          const { value, issues } = translateValue(entry.value, scope);
          input[entry.name] = value;
          variables.set(entry.name, nodeId);
          for (const issue of issues) note(nodeId, issue);
        }
        node.type = 'transform';
        node.input = input;
        node.code = 'return input;';
        break;
      }
      case 'llm': {
        const config = plan.step.config ?? {};
        const system = stringField(config, 'systemPrompt');
        const user = stringField(config, 'userPrompt');
        const models = Array.isArray(config.models) ? config.models : [];
        const named =
          stringField(config, 'model') ??
          (typeof models[0] === 'string' ? models[0] : undefined);
        node.type = 'llm';
        node.model =
          named === undefined ? options.model : named.split(':').at(-1);
        if (named === undefined) {
          note(
            nodeId,
            `this step used the organization's default model; the document now calls "${options.model}" by name — confirm that is the model it should use`,
          );
        }
        if (models.length > 1) {
          note(
            nodeId,
            'this step listed fallback models; a node calls exactly one model, so the rest were dropped',
          );
        }
        if (Array.isArray(config.tools) && config.tools.length > 0) {
          note(
            nodeId,
            'this step gave the model tools; a model node only produces text or a schema-shaped object — move the tool work into its own nodes',
          );
        }
        if (config.knowledgeFileIds !== undefined) {
          note(
            nodeId,
            'this step scoped the model to knowledge files; add an explicit search node for that',
          );
        }
        if (config.contextVariables !== undefined) {
          note(
            nodeId,
            'this step passed extra context variables; put them into the prompt text instead',
          );
        }
        const schema = recordField(config, 'outputSchema');
        if (schema !== undefined) {
          node.outputSchema = schema;
        } else if (stringField(config, 'outputFormat') === 'json') {
          note(
            nodeId,
            'this step asked for JSON without describing it; add an outputSchema so the reply is structured',
          );
        }
        if (system !== undefined) {
          const translated = translateTemplate(system, scope);
          node.system = translated.text;
          for (const issue of translated.issues) note(nodeId, issue);
        }
        const promptSource = user ?? system;
        if (user === undefined) {
          note(
            nodeId,
            'this step had no user prompt; the instructions were used as the prompt',
          );
        }
        const translated = translateTemplate(promptSource ?? '', scope);
        node.prompt = translated.text;
        for (const issue of translated.issues) note(nodeId, issue);
        break;
      }
      default: {
        const capability = plan.capability ?? plan.step.stepType;
        node.type = 'transform';
        node.code = `throw new Error('the "${capability}" step has no equivalent node yet and must be re-authored');\nreturn null;`;
        note(
          nodeId,
          `"${capability}" has no node in the engine; re-author what this step did before running the automation`,
        );
      }
    }

    const when = guardExpression(plan, placement, scope);
    if (when !== undefined) node.when = when;

    if (placement.loop !== undefined) {
      const items = translateTemplate(placement.loop.items, {
        ...scope,
        iterating: false,
      });
      // A loop with no list has already been reported; leaving forEach off
      // keeps the missing list visible instead of iterating nothing quietly.
      if (items.text !== '') {
        node.forEach = items.text.includes('{{')
          ? items.text
          : `{{ ${items.text} }}`;
      }
      for (const issue of items.issues) note(nodeId, issue);
      if (placement.loop.continueOnError) {
        node.onError = 'continue';
        note(
          nodeId,
          'the loop this step ran in continued past a failing item; a node that fails stops its dependents instead — check that skipping the rest is acceptable',
        );
      }
      if (placement.loop.bodySlugs.size > 1) {
        note(
          nodeId,
          'this loop ran several steps per item; each node now iterates the whole list in turn, so the per-item order across steps changed',
        );
      }
    }

    nodes.push(node);
    emitted.set(slug, node);
  }

  // ---- conditions whose branches led nowhere still get read: their
  // expressions may hold something that cannot be translated.

  for (const [slug, plan] of plans) {
    if (plan.role !== 'condition') continue;
    if (guardsUsed.has(slug) || !placements.has(slug)) continue;
    const raw = stringField(plan.step.config, 'expression');
    if (raw === undefined) continue;
    const translated = translateExpression(
      raw,
      scopeFor(placements.get(slug)?.loop),
    );
    for (const issue of translated.issues) note(slug, issue);
  }

  // ---- exclusive branches become when/elseOf pairs.

  for (const [slug, plan] of plans) {
    if (plan.role !== 'condition') continue;
    const placement = placements.get(slug);
    if (placement === undefined || placement.guards.some((g) => g.length > 0)) {
      continue;
    }
    const next = plan.step.nextSteps ?? {};
    const whenNode = emitted.get(next[TRUE_PORT] ?? '');
    const elseNode = emitted.get(next[FALSE_PORT] ?? '');
    if (whenNode === undefined || elseNode === undefined) continue;
    const whenPlacement = placements.get(next[TRUE_PORT] ?? '');
    const elsePlacement = placements.get(next[FALSE_PORT] ?? '');
    const onlyTerm = (p: Placement | undefined, negated: boolean): boolean =>
      p?.guards.length === 1 &&
      p.guards[0].length === 1 &&
      p.guards[0][0].conditionSlug === slug &&
      p.guards[0][0].negated === negated &&
      !p.guards[0][0].perItem;
    if (!onlyTerm(whenPlacement, false) || !onlyTerm(elsePlacement, true)) {
      continue;
    }
    if (whenNode.when === undefined) continue;
    elseNode.elseOf = whenNode.id;
    delete elseNode.when;
  }

  // ---- ordering: a successor that reads nothing from its predecessor still
  // ran after it, and the engine orders on references — a reference in `when`
  // orders without carrying a skip, which is exactly what a bare link meant.

  for (const [slug, node] of emitted) {
    const placement = placements.get(slug);
    if (placement === undefined) continue;
    const references = new Set(referencedNodes(node));
    if (node.elseOf !== undefined) references.add(node.elseOf);
    const ordering: string[] = [];
    for (const predecessor of placement.predecessors) {
      const previous = emitted.get(predecessor);
      if (previous === undefined || previous.id === node.id) continue;
      if (references.has(previous.id)) continue;
      ordering.push(`nodes.${previous.id}.output !== undefined`);
    }
    if (ordering.length === 0) continue;
    const guard = node.when?.replace(/^\{\{\s*|\s*\}\}$/g, '');
    node.when = `{{ ${[...(guard === undefined ? [] : [guard]), ...ordering].join(' && ')} }}`;
  }

  // ---- cycles the engine expresses as repeatUntil, and those it does not.

  for (const cycle of cycles) {
    const inCycle = [...emitted.entries()].filter(
      ([slug]) =>
        (placements.get(slug)?.order ?? -1) >=
          (placements.get(cycle.to)?.order ?? 0) &&
        (placements.get(slug)?.order ?? -1) <=
          (placements.get(cycle.from)?.order ?? 0),
    );
    const target = emitted.get(cycle.to);
    if (inCycle.length === 1 && target !== undefined) {
      const targetGuard = placements.get(cycle.to)?.guards[0] ?? [];
      const extra = cycle.guard.slice(targetGuard.length);
      const terms: string[] = [];
      for (const term of extra) {
        const raw = stringField(
          plans.get(term.conditionSlug)?.step.config,
          'expression',
        );
        if (raw === undefined) continue;
        const translated = translateExpression(raw, scopeFor(undefined));
        for (const issue of translated.issues) note(target.id, issue);
        terms.push(term.negated ? `!(${translated.text})` : translated.text);
      }
      target.repeatUntil =
        terms.length > 0 ? `{{ !(${terms.join(' && ')}) }}` : '{{ true }}';
      target.maxRepeats = DEFAULT_REPEATS;
      note(
        target.id,
        `this step ran again for as long as step "${cycle.from}" sent the automation back to it, with no limit; it now repeats at most ${DEFAULT_REPEATS} times — raise or lower that cap deliberately`,
      );
      continue;
    }
    for (const [, node] of inCycle) {
      note(
        node.id,
        `steps "${cycle.from}" and "${cycle.to}" formed a repeat loop across several steps; a node repeats only itself, so re-author the repeat (a saved automation called per page, for example)`,
      );
    }
  }

  // ---- the document.

  const automation: Automation = {
    version: 1,
    name: toAutomationName(options.name),
    nodes,
  };
  if (options.description !== undefined && options.description !== '') {
    automation.description = options.description;
  }

  const inputSchema = recordField(startStep?.config, 'inputSchema');
  if (inputSchema !== undefined) {
    automation.inputs = { type: 'object', ...inputSchema };
  }

  const outputStep = source.steps.find(
    (step) => plans.get(step.stepSlug)?.role === 'output',
  );
  const mapping = recordField(outputStep?.config, 'mapping');
  if (mapping !== undefined) {
    const { value, issues } = translateValue(mapping, scopeFor(undefined));
    automation.output = value;
    for (const issue of issues) {
      note(outputStep?.stepSlug ?? 'output', issue);
    }
  } else {
    const last = nodes.at(-1);
    if (last !== undefined) automation.output = `{{ nodes.${last.id}.output }}`;
  }

  if (nodes.length > MAX_NODES) {
    note(
      automation.name,
      `the automation converts to ${nodes.length} nodes, above the ${MAX_NODES} a document may hold; split it into saved automations called as subautomation nodes`,
    );
  }

  return { automation, needsReview: notes };
}

/** Node ids a node already references — an ordering reference is only added
 * where there is no data reference to ride on. */
function referencedNodes(node: NodeDef): string[] {
  const sources = [
    JSON.stringify(node.input ?? {}),
    node.prompt ?? '',
    node.system ?? '',
    node.code ?? '',
    node.forEach ?? '',
    node.when ?? '',
  ].join('\n');
  return [...sources.matchAll(/\bnodes\s*\.\s*([A-Za-z_$][\w$]*)/g)].map(
    (match) => match[1],
  );
}
