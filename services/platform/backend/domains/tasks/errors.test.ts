// @vitest-environment node

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A task refusal's sentence is the domain's own prose. It travels beside its
 * code to every door — the app's `{error, message}`, REST's `{error, code}`,
 * and an agent's `invalid_args` tool result (`toolResultFromError`) — so it
 * never carries a value: not what the caller sent, and never a stored one
 * (another task's title, a member's name) that a later change interpolates
 * without anyone deciding it may travel.
 *
 * This guard reads every `new TaskError(…)` and `new TaskReviewError(…)` in
 * the backend, and every `new ProjectError(…)` a task door can relay: the
 * task domain's own, and those of each projects-domain function a task door
 * reaches ({@link projectFunctionsReached}) — the app door's `handleError`
 * relays every `ProjectError` beside `TaskError`. It admits a message that
 * is a literal or is built only from what {@link ADMITTED} names: the shared
 * limit sentences (`core/tasks/helpers.ts`'s `task*Refusal`, which state a
 * cap, its unit and a measured length — `helpers.test.ts` pins them), plain
 * constants, and the one reviewed exception listed there with its reason. A
 * new piece fails here until it is either made static or reviewed onto the
 * list.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'node_modules' ? [] : sourceFiles(full);
    }
    return full.endsWith('.ts') && !full.includes('.test.') ? [full] : [];
  });
}

const backendPath = (file: string): string =>
  path.relative(BACKEND, file).split(path.sep).join('/');

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

/**
 * Where a task refusal is answered from, as backend paths: the task domain
 * and its app door, the folder the external-issue intake mints, the REST
 * task door, the workflow task natives' store and the agent's write shim.
 */
const TASK_DOORS = [
  'domains/tasks/',
  'domains/folders/service.ts',
  'rest/v1-tasks.ts',
  'domains/connectors/task-store.ts',
  'domains/sandbox/workspace-write-shim.ts',
];

/** The module's top-level functions by name, declared or assigned. */
function topLevelFunctions(tree: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  for (const statement of tree.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return functions;
}

/** The top-level function or constant a node sits in, by name. */
function topLevelName(node: ts.Node): string | undefined {
  let current = node;
  while (!ts.isSourceFile(current.parent)) current = current.parent;
  if (ts.isFunctionDeclaration(current)) return current.name?.text;
  if (ts.isVariableStatement(current)) {
    const [declaration] = current.declarationList.declarations;
    return declaration && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined;
  }
  return undefined;
}

/**
 * The functions of each `domains/projects/` module a task door reaches: the
 * ones a door imports, and every function of the same module those call in
 * turn. A `ProjectError` one of them throws reaches the door's answer.
 */
function projectFunctionsReached(
  files: readonly string[],
): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  for (const file of files) {
    const relative = backendPath(file);
    if (
      relative.endsWith('.integration.ts') ||
      !TASK_DOORS.some((door) => relative.startsWith(door))
    ) {
      continue;
    }
    for (const statement of parse(file).statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.importClause?.isTypeOnly === true
      ) {
        continue;
      }
      const target = backendPath(
        path.resolve(path.dirname(file), statement.moduleSpecifier.text),
      ).replace(/(\.ts)?$/, '.ts');
      const bindings = statement.importClause?.namedBindings;
      if (
        !target.startsWith('domains/projects/') ||
        bindings === undefined ||
        !ts.isNamedImports(bindings)
      ) {
        continue;
      }
      const names = imported.get(target) ?? new Set<string>();
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) {
          names.add((element.propertyName ?? element.name).text);
        }
      }
      imported.set(target, names);
    }
  }
  const reached = new Map<string, Set<string>>();
  for (const [module, names] of imported) {
    const functions = topLevelFunctions(parse(path.join(BACKEND, module)));
    const seen = new Set<string>();
    const queue = [...names];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      const body = functions.get(name);
      if (body === undefined || seen.has(name)) continue;
      seen.add(name);
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && functions.has(node.text)) {
          queue.push(node.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
    }
    reached.set(module, seen);
  }
  return reached;
}

/** `<file> <code> <piece>` for every non-literal piece of a refusal's
 * message — a template's interpolations, or the whole expression when the
 * message is not a template at all. */
function interpolatedPieces(): string[] {
  const pieces: string[] = [];
  const files = sourceFiles(BACKEND);
  const reached = projectFunctionsReached(files);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!/new (TaskError|TaskReviewError|ProjectError)\(/.test(source)) {
      continue;
    }
    const relative = backendPath(file);
    const inTasks = relative.startsWith('domains/tasks/');
    const reachedHere = reached.get(relative);
    const relayed = (node: ts.Node): boolean =>
      inTasks || reachedHere?.has(topLevelName(node) ?? '') === true;
    const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'TaskError' ||
          node.expression.text === 'TaskReviewError' ||
          (node.expression.text === 'ProjectError' && relayed(node)))
      ) {
        const [code, message] = node.arguments ?? [];
        if (
          message !== undefined &&
          !ts.isStringLiteral(message) &&
          !ts.isNoSubstitutionTemplateLiteral(message)
        ) {
          const parts = ts.isTemplateExpression(message)
            ? message.templateSpans.map((span) => span.expression)
            : [message];
          for (const part of parts) {
            pieces.push(
              `${relative} ${code?.getText(tree) ?? '?'} ${part.getText(tree)}`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return pieces.sort();
}

/** Every non-literal piece a task refusal may carry, and why it may. */
const ADMITTED = [
  // The shared limit sentences (`taskCommentRefusal`, `taskTitleRefusal`,
  // `taskDescriptionRefusal`, `taskLabelCountRefusal`,
  // `taskLabelNameRefusal`): a cap, its unit and a measured length.
  "domains/tasks/comments.ts 'TASK_COMMENT_INVALID' refusal",
  "domains/tasks/comments.ts 'TASK_COMMENT_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_DESCRIPTION_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_LABELS_INVALID' countRefusal",
  "domains/tasks/service.ts 'TASK_LABELS_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_TITLE_INVALID' refusal",
  // A constant.
  "domains/tasks/service.ts 'TASK_ATTACHMENTS_INVALID' TASK_ATTACHMENTS_MAX",
  // The competences a review policy requires and the responder lacks: the
  // organization's own governance names, told to the PERSON approving so
  // they know what to acquire. Only a user's approve runs that check
  // (`closePendingTaskReviewOnStatusLeave`); an agent's status move and the
  // external-ref sync close as `system`, so it never reaches a tool result.
  "domains/tasks/reviews.ts 'REVIEW_COMPETENCE_REQUIRED' held.missing.join(', ')",
].sort();

describe('task refusal sentences', () => {
  it('follow every projects-domain function a task door reaches', () => {
    // The doors' own imports, and what those call in turn: an access check
    // throws through `assertSameOrg` before its own refusals.
    const reached = projectFunctionsReached(sourceFiles(BACKEND));
    expect([...reached.keys()]).toEqual(['domains/projects/service.ts']);
    expect([...(reached.get('domains/projects/service.ts') ?? [])]).toEqual(
      expect.arrayContaining([
        'assertSameOrg',
        'assertWritable',
        'getProjectAuthContext',
        'listProjects',
        'loadProjectOrThrow',
      ]),
    );
  });

  it('carry no value beyond the shared limit sentences and constants', () => {
    expect(
      interpolatedPieces(),
      'A task refusal interpolates something new. Its sentence reaches the ' +
        'app, REST and the agent tool result: make it static (put a value ' +
        'the caller needs in the error `data`, which the agent door never ' +
        'relays) or, if it is a constant or a measured length, add it to ' +
        'ADMITTED with the reason.',
    ).toEqual(ADMITTED);
  });
});
