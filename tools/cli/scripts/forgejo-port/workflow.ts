/**
 * Reading, folding and writing one workflow document.
 *
 * Everything works on `yaml`'s Document, which keeps comments, so a ported
 * workflow still explains itself. The port never re-implements what a workflow
 * means: it removes what cannot run on Forgejo, decides what the generated file's
 * own triggers decide, and leaves the rest as it was.
 */

import {
  Document,
  Scalar,
  YAMLMap,
  YAMLSeq,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Pair,
} from 'yaml';

import {
  ExpressionError,
  type Expr,
  foldTemplate,
  hasExpression,
  keepStatusFunction,
  parseExpression,
  parseTemplate,
  printExpression,
  simplify,
  truthy,
  type Facts,
} from './expression';

export type Workflow = Document.Parsed;

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'WorkflowError';
  }
}

/** One thing the port did, said once so a reviewer can read the whole rewrite. */
export interface Change {
  readonly file: string;
  /** Where in the workflow: `jobs.build.steps[2]`. */
  readonly at: string;
  readonly rule: string;
  readonly detail: string;
}

/** What a run of the port did, and what it could not make sense of. */
export interface Report {
  readonly changes: Change[];
  readonly warnings: Change[];
}

export function emptyReport(): Report {
  return { changes: [], warnings: [] };
}

// --- reading and writing ------------------------------------------------------

/** Parse a workflow, refuse a broken one, and expand its anchors and aliases. */
export function readWorkflow(source: string, file: string): Workflow {
  const doc = parseDocument(source);
  const [first] = doc.errors;
  if (first) throw new WorkflowError(first.message, file);
  if (!isMap(doc.contents)) throw new WorkflowError('not a mapping', file);
  expandAliases(doc, file);
  return doc;
}

/**
 * Replace every alias with a copy of what it points at and drop the anchors. The
 * port removes and rewrites jobs, so an anchor defined in one job and used in
 * another must not decide what survives.
 */
function expandAliases(doc: Document, file: string): void {
  visit(doc, {
    Alias(_key, alias) {
      const target = alias.resolve(doc);
      if (!target)
        throw new WorkflowError(`unknown anchor ${alias.source}`, file);
      return copyOf(target);
    },
  });
  visit(doc, {
    Node(_key, node) {
      if (isNode(node) && 'anchor' in node && node.anchor)
        node.anchor = undefined;
    },
  });
}

/** `clone()` keeps the node's class, which yaml's declarations only say is "a node". */
function copyOf<T extends Scalar | YAMLMap | YAMLSeq>(target: T): T {
  return target.clone() as T;
}

export function writeWorkflow(doc: Document): string {
  return doc.toString({
    lineWidth: 0,
    indent: 2,
    flowCollectionPadding: false,
  });
}

// --- reading the tree ---------------------------------------------------------

export function rootOf(doc: Document): YAMLMap {
  if (!isMap(doc.contents))
    throw new WorkflowError('not a mapping', 'document');
  return doc.contents;
}

function mapAt(map: YAMLMap, key: string): YAMLMap | undefined {
  const node = map.get(key);
  return isMap(node) ? node : undefined;
}

export function jobsOf(doc: Document): YAMLMap {
  const jobs = mapAt(rootOf(doc), 'jobs');
  if (!jobs) throw new WorkflowError('has no jobs', 'document');
  return jobs;
}

export function stringOf(node: unknown): string | undefined {
  if (typeof node === 'string') return node;
  return isScalar(node) && typeof node.value === 'string'
    ? node.value
    : undefined;
}

export function jobIds(doc: Document): string[] {
  return jobsOf(doc).items.flatMap((pair) => {
    const id = stringOf(pair.key);
    return id === undefined ? [] : [id];
  });
}

export function jobOf(doc: Document, id: string): YAMLMap | undefined {
  return mapAt(jobsOf(doc), id);
}

export function stepsOf(job: YAMLMap): YAMLSeq | undefined {
  const steps = job.get('steps');
  return isSeq(steps) ? steps : undefined;
}

/** The ids a job needs, whether `needs:` is one name or a list. */
export function needsOf(job: YAMLMap): string[] {
  const node = job.get('needs');
  const single = stringOf(node);
  if (single !== undefined) return [single];
  if (!isSeq(node)) return [];
  return node.items.flatMap((item) => {
    const name = stringOf(item);
    return name === undefined ? [] : [name];
  });
}

/** Write `needs:` back as a list, or take it away when nothing is left. */
export function setNeeds(job: YAMLMap, ids: readonly string[]): void {
  if (ids.length === 0) {
    job.delete('needs');
    return;
  }
  const seq = new YAMLSeq();
  seq.flow = true;
  for (const id of ids) seq.add(new Scalar(id));
  job.set('needs', seq);
}

/** Remove jobs, and the names of those jobs from every other job's `needs:`. */
export function removeJobs(doc: Document, ids: readonly string[]): void {
  const gone = new Set(ids);
  const jobs = jobsOf(doc);
  for (const id of gone) jobs.delete(id);
  // The blank line that separated the first job from its neighbour would now open the map.
  const [first] = jobs.items;
  if (isScalar(first?.key)) first.key.spaceBefore = false;
  for (const pair of jobs.items) {
    const job = isMap(pair.value) ? pair.value : undefined;
    if (!job) continue;
    const needs = needsOf(job);
    const kept = needs.filter((id) => !gone.has(id));
    if (kept.length !== needs.length) setNeeds(job, kept);
  }
}

// --- folding ------------------------------------------------------------------

/** What a condition came to once the facts were applied. */
type Condition =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'always' }
  | { readonly kind: 'never' }
  | { readonly kind: 'text'; readonly text: string };

/** Fold one `if:` value: a bare expression, or one wrapped in `${{ }}`. */
export function foldCondition(source: string, facts: Facts): Condition {
  let wrapped = false;
  const expression = ((): ReturnType<typeof parseExpression> => {
    if (!hasExpression(source)) return parseExpression(source);
    wrapped = true;
    const parts = parseTemplate(source);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only?.kind !== 'expr')
      throw new ExpressionError(
        'A condition must be one expression',
        source,
        0,
      );
    return only.expr;
  })();
  const folded = keepStatusFunction(
    expression,
    simplify(expression, facts, 'condition'),
  );
  const after = printExpression(folded);
  if (folded.kind === 'literal' && after !== printExpression(expression))
    return { kind: truthy(folded.value) ? 'always' : 'never' };
  const everywhere = holdsForEveryEvent(folded, facts);
  if (everywhere !== undefined)
    return { kind: everywhere ? 'always' : 'never' };
  if (after === printExpression(expression)) return { kind: 'unchanged' };
  return { kind: 'text', text: wrapped ? `\${{ ${after} }}` : after };
}

/**
 * Whether a condition comes to the same answer for each event the workflow has. A
 * condition like `event != 'pull_request' && event != 'push'` mentions no event twice
 * in the same way, so folding one comparison at a time cannot see that a workflow with
 * only those two events never meets it.
 */
function holdsForEveryEvent(
  condition: ReturnType<typeof parseExpression>,
  facts: Facts,
): boolean | undefined {
  const events = facts.oneOf?.get('github.event_name');
  if (!events || events.length < 2) return undefined;
  const answers = events.map((event) => {
    const here = simplify(
      condition,
      {
        ...facts,
        values: new Map([
          ...(facts.values ?? []),
          ['github.event_name', event],
        ]),
      },
      'condition',
    );
    return here.kind === 'literal' ? truthy(here.value) : undefined;
  });
  if (answers.every((answer) => answer === true)) return true;
  if (answers.every((answer) => answer === false)) return false;
  return undefined;
}

export interface FoldContext {
  readonly file: string;
  readonly facts: Facts;
  readonly report: Report;
  /** Facts that hold inside one job only, such as the size of its own matrix. */
  readonly jobFacts?: ReadonlyMap<string, Facts>;
}

/** The facts of a context with another set added on top. */
function withFacts(
  context: FoldContext,
  extra: Facts | undefined,
): FoldContext {
  if (!extra) return context;
  const values = new Map([
    ...(context.facts.values ?? []),
    ...(extra.values ?? []),
  ]);
  const oneOf = new Map([
    ...(context.facts.oneOf ?? []),
    ...(extra.oneOf ?? []),
  ]);
  return {
    ...context,
    facts: {
      values,
      oneOf,
      absent: [...(context.facts.absent ?? []), ...(extra.absent ?? [])],
      conditional: new Map([
        ...(context.facts.conditional ?? []),
        ...(extra.conditional ?? []),
      ]),
      aliases: context.facts.aliases,
    },
  };
}

/**
 * Fold what a workflow says by what the port knows. Returns the jobs that can
 * never run (their own condition is decided false); the caller removes them and
 * folds again, because a removed job is itself a fact for the jobs that needed it.
 * A step that can never run is removed here.
 */
export function foldWorkflow(doc: Document, context: FoldContext): string[] {
  const dead: string[] = [];
  for (const pair of jobsOf(doc).items) {
    const id = stringOf(pair.key);
    const job = isMap(pair.value) ? pair.value : undefined;
    if (id === undefined || !job) continue;
    const at = `jobs.${id}`;
    const here = withFacts(context, context.jobFacts?.get(id));
    if (foldIf(job, at, here) === 'dead') {
      dead.push(id);
      continue;
    }
    const steps = stepsOf(job);
    if (steps) foldSteps(steps, at, here);
    foldMapValues(job, at, here, new Set(['if', 'steps']));
  }
  foldMapValues(rootOf(doc), '', context, new Set(['jobs']));
  return dead;
}

/** Fold a composite action the way a workflow is: its steps, and the strings around them. */
export function foldAction(doc: Document, context: FoldContext): void {
  const root = rootOf(doc);
  const runs = root.get('runs');
  if (isMap(runs)) {
    const steps = runs.get('steps');
    if (isSeq(steps)) foldSteps(steps, 'runs', context);
    foldMapValues(runs, 'runs', context, new Set(['steps']));
  }
  foldMapValues(root, '', context, new Set(['runs']));
}

function foldSteps(steps: YAMLSeq, jobAt: string, context: FoldContext): void {
  for (let index = steps.items.length - 1; index >= 0; index -= 1) {
    const step = steps.items[index];
    if (!isMap(step)) continue;
    const at = `${jobAt}.steps[${index}]`;
    if (foldIf(step, at, context) === 'dead') {
      steps.items.splice(index, 1);
      continue;
    }
    foldMapValues(step, at, context, new Set(['if']));
  }
}

function foldIf(
  owner: YAMLMap,
  at: string,
  context: FoldContext,
): 'alive' | 'dead' {
  const source = stringOf(owner.get('if'));
  if (source === undefined) return 'alive';
  let outcome: Condition;
  try {
    outcome = foldCondition(source, context.facts);
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    context.report.warnings.push({
      file: context.file,
      at,
      rule: 'fold-condition',
      detail: error.message,
    });
    return 'alive';
  }
  const written = oneLine(source);
  switch (outcome.kind) {
    case 'unchanged':
      return 'alive';
    case 'always':
      owner.delete('if');
      context.report.changes.push({
        file: context.file,
        at,
        rule: 'condition-always',
        detail: `dropped \`if: ${written}\`, which always holds here`,
      });
      return 'alive';
    case 'never':
      context.report.changes.push({
        file: context.file,
        at,
        rule: 'condition-never',
        detail: `removed: \`if: ${written}\` can never hold here`,
      });
      return 'dead';
    case 'text': {
      owner.set('if', new Scalar(outcome.text));
      context.report.changes.push({
        file: context.file,
        at,
        rule: 'condition-folded',
        detail: `\`if: ${written}\` is now \`${oneLine(outcome.text)}\``,
      });
      return 'alive';
    }
  }
}

/** Fold every string below a mapping except the keys named in `skip`. */
function foldMapValues(
  map: YAMLMap,
  at: string,
  context: FoldContext,
  skip: ReadonlySet<string>,
): void {
  // Backwards: folding may delete the pair it is looking at.
  for (let index = map.items.length - 1; index >= 0; index -= 1) {
    const pair = map.items[index];
    const key = pair && stringOf(pair.key);
    if (!pair || key === undefined || skip.has(key)) continue;
    foldValue(
      map,
      pair,
      at === '' ? key : `${at}.${key}`,
      key === 'with' || key === 'run-name',
      context,
    );
  }
}

function foldValue(
  parent: YAMLMap,
  pair: Pair,
  at: string,
  dropWhenEmpty: boolean,
  context: FoldContext,
): void {
  const value = pair.value;
  if (isScalar(value)) {
    const outcome = foldScalar(value, at, context);
    // What stood above `run-name` is the file's own description: the next key keeps it.
    if (outcome === 'empty' && dropWhenEmpty)
      deletePair(parent, pair, at === 'run-name');
    return;
  }
  if (isMap(value)) {
    // The inputs of an action: an input that comes to nothing is an input not given.
    for (let index = value.items.length - 1; index >= 0; index -= 1) {
      const inner = value.items[index];
      const key = inner && stringOf(inner.key);
      if (!inner || key === undefined) continue;
      const here = `${at}.${key}`;
      const innerValue = inner.value;
      if (isScalar(innerValue)) {
        if (foldScalar(innerValue, here, context) === 'empty' && dropWhenEmpty)
          value.delete(inner.key);
      } else foldValue(value, inner, here, false, context);
    }
    // An action given nothing is given no inputs: `with: {}` says nothing.
    if (value.items.length === 0 && dropWhenEmpty)
      deletePair(parent, pair, false);
    return;
  }
  if (isSeq(value)) {
    for (const [index, item] of value.items.entries()) {
      const here = `${at}[${index}]`;
      if (isScalar(item)) foldScalar(item, here, context);
      else if (isMap(item)) foldMapValues(item, here, context, new Set());
    }
  }
}

/** Delete a pair; with `carry`, the comment that stood above it moves to the pair that follows. */
function deletePair(parent: YAMLMap, pair: Pair, carry: boolean): void {
  const index = parent.items.indexOf(pair);
  if (index < 0) return;
  const comment = isNode(pair.key) ? pair.key.commentBefore : undefined;
  parent.items.splice(index, 1);
  const next = parent.items[index];
  if (carry && comment && next && isNode(next.key))
    next.key.commentBefore = next.key.commentBefore
      ? `${comment}\n${next.key.commentBefore}`
      : comment;
}

/** `empty` when a whole value came to nothing (null or the empty string). */
function foldScalar(
  node: Scalar,
  at: string,
  context: FoldContext,
): 'kept' | 'changed' | 'empty' {
  if (typeof node.value !== 'string' || !hasExpression(node.value))
    return 'kept';
  const source = node.value;
  let folded: ReturnType<typeof foldTemplate>;
  try {
    folded = foldTemplate(source, context.facts, 'value');
  } catch (error) {
    if (!(error instanceof ExpressionError)) throw error;
    context.report.warnings.push({
      file: context.file,
      at,
      rule: 'fold-value',
      detail: error.message,
    });
    return 'kept';
  }
  if (folded.kind === 'text') {
    if (sameTemplate(source, folded.text)) return 'kept';
    node.value = folded.text;
    context.report.changes.push({
      file: context.file,
      at,
      rule: 'value-folded',
      detail: `\`${oneLine(source)}\` is now \`${oneLine(folded.text)}\``,
    });
    return 'changed';
  }
  context.report.changes.push({
    file: context.file,
    at,
    rule: 'value-constant',
    detail: `\`${oneLine(source)}\` is always ${JSON.stringify(folded.value)}`,
  });
  if (folded.value === null || folded.value === '') {
    node.value = '';
    node.type = Scalar.QUOTE_SINGLE;
    return 'empty';
  }
  node.value = folded.value;
  node.type = Scalar.PLAIN;
  return 'changed';
}

/** Whether two strings hold the same text and the same expressions, spacing aside. */
function sameTemplate(a: string, b: string): boolean {
  const left = parseTemplate(a);
  const right = parseTemplate(b);
  return (
    left.length === right.length &&
    left.every((part, index) => {
      const other = right[index];
      if (!other || part.kind !== other.kind) return false;
      if (part.kind === 'text' && other.kind === 'text')
        return part.text === other.text;
      if (part.kind === 'expr' && other.kind === 'expr')
        return printExpression(part.expr) === printExpression(other.expr);
      return false;
    })
  );
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Change one `if:` with a function of its expression. The function returns the new
 * expression, or `undefined` when nothing is left of the condition (it always holds).
 * Returns whether the condition changed.
 */
export function editCondition(
  owner: YAMLMap,
  edit: (expression: Expr) => Expr | undefined,
): boolean {
  const source = stringOf(owner.get('if'));
  if (source === undefined) return false;
  const wrapped = hasExpression(source);
  let expression: Expr;
  if (wrapped) {
    const parts = parseTemplate(source);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only?.kind !== 'expr')
      throw new ExpressionError(
        'A condition must be one expression',
        source,
        0,
      );
    expression = only.expr;
  } else expression = parseExpression(source);
  const edited = edit(expression);
  if (edited === undefined) {
    owner.delete('if');
    return true;
  }
  if (printExpression(edited) === printExpression(expression)) return false;
  const text = printExpression(edited);
  owner.set('if', new Scalar(wrapped ? `\${{ ${text} }}` : text));
  return true;
}

/** The text of a step's or job's `if:`, as written. */
export function conditionOf(owner: YAMLMap): string | undefined {
  return stringOf(owner.get('if'));
}

/** Every list of steps a document has: one per job of a workflow, or the steps of a composite action. */
export function stepLists(doc: Document): { at: string; steps: YAMLSeq }[] {
  const root = rootOf(doc);
  const lists: { at: string; steps: YAMLSeq }[] = [];
  const runs = root.get('runs');
  if (isMap(runs)) {
    const steps = runs.get('steps');
    if (isSeq(steps)) lists.push({ at: 'runs', steps });
  }
  const jobs = root.get('jobs');
  if (isMap(jobs)) {
    for (const pair of jobs.items) {
      const id = stringOf(pair.key);
      const job = isMap(pair.value) ? pair.value : undefined;
      const steps = job && stepsOf(job);
      if (id !== undefined && steps) lists.push({ at: `jobs.${id}`, steps });
    }
  }
  return lists;
}

/** A step's `uses:`, split into what it names and the ref after the `@`. */
export function parseUses(
  uses: string,
):
  | { kind: 'remote'; name: string; ref: string }
  | { kind: 'local'; path: string }
  | { kind: 'docker' } {
  if (uses.startsWith('./')) return { kind: 'local', path: uses };
  if (uses.startsWith('docker://')) return { kind: 'docker' };
  const at = uses.lastIndexOf('@');
  return at === -1
    ? { kind: 'remote', name: uses, ref: '' }
    : { kind: 'remote', name: uses.slice(0, at), ref: uses.slice(at + 1) };
}
