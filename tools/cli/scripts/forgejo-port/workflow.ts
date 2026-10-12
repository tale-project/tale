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
  foldTemplate,
  hasExpression,
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
  const node = map.get(key, true);
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
  const steps = job.get('steps', true);
  return isSeq(steps) ? steps : undefined;
}

/** The ids a job needs, whether `needs:` is one name or a list. */
export function needsOf(job: YAMLMap): string[] {
  const node = job.get('needs', true);
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
  const folded = simplify(expression, facts, 'condition');
  const after = printExpression(folded);
  if (after === printExpression(expression)) return { kind: 'unchanged' };
  if (folded.kind === 'literal')
    return { kind: truthy(folded.value) ? 'always' : 'never' };
  return { kind: 'text', text: wrapped ? `\${{ ${after} }}` : after };
}

export interface FoldContext {
  readonly file: string;
  readonly facts: Facts;
  readonly report: Report;
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
    if (foldIf(job, at, context) === 'dead') {
      dead.push(id);
      continue;
    }
    const steps = stepsOf(job);
    if (steps) foldSteps(steps, at, context);
    foldMapValues(job, at, context, new Set(['if', 'steps']));
  }
  foldMapValues(rootOf(doc), '', context, new Set(['jobs']));
  return dead;
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
  const source = stringOf(owner.get('if', true));
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
    if (outcome === 'empty' && dropWhenEmpty) parent.delete(pair.key);
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
