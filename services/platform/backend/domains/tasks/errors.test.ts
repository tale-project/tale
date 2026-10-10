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
 * the backend, every `new RestRefusal(…)` and `new FolderError(…)` a door's
 * own file builds, and every `new ProjectError(…)` and `new AutomationError(…)`
 * a task door can relay: those every door's own file builds ({@link
 * TASK_DOORS} — the task domain, the REST task door, the natives' store, the
 * write shim, the intake folder), and those of each projects- or
 * automations-domain function a task door reaches
 * ({@link domainFunctionsReached}) — the app door's `handleError` relays
 * every `ProjectError` and `AutomationError` beside `TaskError` word for
 * word, as REST's envelope and a workflow's trace carry them. It admits a
 * message that is a literal or is built only from what {@link ADMITTED}
 * names: the shared limit sentences (`core/tasks/helpers.ts`'s
 * `task*Refusal`, which state a cap, its unit and a measured length —
 * `helpers.test.ts` pins them), plain constants, and the reviewed
 * exceptions listed there with their reasons. A new piece fails here until
 * it is either made static or reviewed onto the list.
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
 * The functions of each module under `domain` (`domains/projects/`,
 * `domains/automations/`) a task door reaches: the ones a door imports, and
 * every function of the same module those call in turn. A `ProjectError`
 * or `AutomationError` one of them throws reaches the door's answer.
 */
function domainFunctionsReached(
  files: readonly string[],
  domain: string,
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
        !target.startsWith(domain) ||
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

/** Whether an expression is prose alone: a literal, or a choice between
 * literals — the condition picks a sentence and never reaches the text. */
function isStaticText(node: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(node)) return isStaticText(node.expression);
  if (ts.isConditionalExpression(node)) {
    return isStaticText(node.whenTrue) && isStaticText(node.whenFalse);
  }
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** What the guard reads: `<file> <code>` for every refusal it judges
 * (`judged`), and `<file> <code> <piece>` for every non-literal piece of
 * one's message (`pieces`) — a template's interpolations, or the whole
 * expression when the message is not a template or a choice of literals. */
function scanRefusals(): { judged: string[]; pieces: string[] } {
  const judged: string[] = [];
  const pieces: string[] = [];
  const files = sourceFiles(BACKEND);
  const reachedBy: Record<string, Map<string, Set<string>>> = {
    ProjectError: domainFunctionsReached(files, 'domains/projects/'),
    AutomationError: domainFunctionsReached(files, 'domains/automations/'),
  };
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (
      !/new (TaskError|TaskReviewError|ProjectError|AutomationError|RestRefusal|FolderError)\(/.test(
        source,
      )
    ) {
      continue;
    }
    const relative = backendPath(file);
    // A door's own file relays every refusal it builds: the task domain,
    // and the REST task door, the natives' store, the write shim and the
    // intake folder, whose `AutomationError`s went unread while only
    // `domains/tasks/` counted (TALE-75 review).
    const inDoor = TASK_DOORS.some((door) => relative.startsWith(door));
    /** Whether a door relays this `ProjectError` / `AutomationError`. */
    const relayed = (node: ts.Node, error: string): boolean =>
      inDoor ||
      reachedBy[error]?.get(relative)?.has(topLevelName(node) ?? '') === true;
    const tree = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    /** Whether this constructor's refusal is one a task door answers. */
    const judges = (node: ts.Node, error: string): boolean => {
      if (error === 'TaskError' || error === 'TaskReviewError') return true;
      if (error === 'ProjectError' || error === 'AutomationError') {
        return relayed(node, error);
      }
      // REST's own refusal and the folder domain's: read where a door's own
      // file builds them (the REST task door, the intake folder).
      return (error === 'RestRefusal' || error === 'FolderError') && inDoor;
    };
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        judges(node, node.expression.text)
      ) {
        // `RestRefusal` takes its sentence first and its code third; every
        // other refusal takes the code, then the sentence.
        const args = node.arguments ?? [];
        const [code, message] =
          node.expression.text === 'RestRefusal'
            ? [args[2], args[0]]
            : [args[0], args[1]];
        judged.push(`${relative} ${code?.getText(tree) ?? '?'}`);
        if (message !== undefined && !isStaticText(message)) {
          const parts = ts.isTemplateExpression(message)
            ? message.templateSpans
                .map((span) => span.expression)
                .filter((part) => !isStaticText(part))
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
  return { judged: judged.sort(), pieces: pieces.sort() };
}

/** Every non-literal piece a task refusal may carry, and why it may. */
const ADMITTED = [
  // The shared limit sentences (`taskCommentRefusal`, `taskTitleRefusal`,
  // `taskDescriptionRefusal`, `taskLabelCountRefusal`,
  // `taskLabelNameRefusal`): a cap, its unit and a measured length.
  "domains/tasks/comments.ts 'TASK_COMMENT_INVALID' refusal",
  "domains/tasks/comments.ts 'TASK_COMMENT_INVALID' refusal",
  "domains/tasks/review-repair.ts 'TASK_COMMENT_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_DESCRIPTION_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_LABELS_INVALID' countRefusal",
  "domains/tasks/service.ts 'TASK_LABELS_INVALID' refusal",
  "domains/tasks/service.ts 'TASK_TITLE_INVALID' refusal",
  // A constant.
  "domains/tasks/service.ts 'TASK_ATTACHMENTS_INVALID' TASK_ATTACHMENTS_MAX",
  // The one static sentence both binding checks share (a top-level string
  // literal in `domains/automations/store.ts`), so the run insert and the
  // REST intake cannot word it apart again.
  "domains/automations/store.ts 'AUTOMATION_PROJECT_FORBIDDEN' AUTOMATION_NOT_BOUND_SENTENCE",
  "rest/v1-tasks.ts 'AUTOMATION_PROJECT_FORBIDDEN' AUTOMATION_NOT_BOUND_SENTENCE",
  // The task's own status (`TaskStatus`, a fixed vocabulary), told to the
  // caller deciding its review: the state it is in, never a value it sent.
  "rest/v1-tasks.ts 'TASK_NOT_IN_REVIEW' task.status",
  // The folder domain re-throws two static sentences under its own class:
  // `FolderNameError`'s "Folder name <rule>", the rule one of the fixed
  // phrases of `FOLDER_NAME_RULES` (`domains/folders/paths.ts`), never the
  // name; and `TeamAssignmentError`'s literals (`core/lib/audience.ts`),
  // whose team ids ride in `data`.
  "domains/folders/service.ts 'FOLDER_NAME_INVALID' error.message",
  'domains/folders/service.ts error.code error.message',
  // The organization's standard agent refuses a start under the projects
  // domain's class (`refusalError` in `domains/projects/standard-agent.ts`:
  // one fixed sentence per reason, the reason in `data`); the kick re-throws
  // its code and sentence under the task door's own.
  'domains/tasks/agent-runs.ts error.code error.message',
  // The competences a review policy requires and the responder lacks: the
  // organization's own governance names, told to the PERSON approving so
  // they know what to acquire. Only a user's approve runs that check
  // (`closePendingTaskReviewOnStatusLeave`); an agent's status move and the
  // external-ref sync close as `system`, so it never reaches a tool result.
  "domains/tasks/reviews.ts 'REVIEW_COMPETENCE_REQUIRED' held.missing.join(', ')",
  // The first problem of a run input the deployed version's `inputs` schema
  // refuses (`describeSchemaErrors`): a path into the input and the rule it
  // broke ("is required", "must be string") — never an input's value. At a
  // task door the input is the door's own task subject
  // (`taskWorkflowSubjectInput`), so the path is one of its fixed keys or one
  // the automation's schema requires. The rule is Ajv's own, and can quote
  // that stored schema: a pattern (`must match pattern "^[A-Z]"`), a bound
  // (`must be <= 10`). It is admitted because the schema is the automation
  // author's contract with whoever starts it — the rule the task must meet
  // to start, which the starter needs to fix it — and names no person, no
  // other task and nothing the caller sent (`schema.test.ts` pins both
  // halves). Every problem rides `data.issues`.
  "domains/automations/store.ts 'AUTOMATION_INPUT_INVALID' named",
].sort();

describe('task refusal sentences', () => {
  it('follow every projects-domain function a task door reaches', () => {
    // The doors' own imports, and what those call in turn. The task doors
    // judge access themselves (`assertTaskWorkable` and its siblings), so
    // no projects-domain access check throws through them any more.
    const reached = domainFunctionsReached(
      sourceFiles(BACKEND),
      'domains/projects/',
    );
    // Every start reaches the standard agent's kick view, whose refusals are
    // fixed sentences (`refusalError`). The task kinds' MCP settings handlers
    // share the project kinds' id and read helpers (`idParts`,
    // `managedResource`, `projectAuthOf`): a malformed id is refused with the
    // id the caller sent, and nothing else they throw reaches a person.
    expect([...reached.keys()].sort()).toEqual([
      'domains/projects/service.ts',
      'domains/projects/settings-resource.ts',
      'domains/projects/standard-agent.ts',
    ]);
    expect([...(reached.get('domains/projects/service.ts') ?? [])]).toEqual(
      expect.arrayContaining([
        'getProjectAuthContext',
        'listProjects',
        'loadProjectOrThrow',
      ]),
    );
    expect([
      ...(reached.get('domains/projects/standard-agent.ts') ?? []),
    ]).toEqual(expect.arrayContaining(['standardAgentServingForKick']));
  });

  it('follow every automations-domain function a task door reaches', () => {
    // A task start reaches the run insert, and through it the project
    // binding check: the app door used to relay its sentence, which named
    // the `workflowSlug` the caller sent, word for word.
    const reached = domainFunctionsReached(
      sourceFiles(BACKEND),
      'domains/automations/',
    );
    expect([...(reached.get('domains/automations/store.ts') ?? [])]).toEqual(
      expect.arrayContaining([
        'beginRunInTx',
        'resolveRunProject',
        'bindingProjectIds',
        'cancelRunInTx',
        'getRun',
      ]),
    );
  });

  it("read every refusal a door's own file builds", () => {
    // The REST task door's not-deployed sentence repeated the slug the
    // caller sent while only `domains/tasks/` was read (TALE-75 review):
    // each door file's `AutomationError`s and `ProjectError`s are judged,
    // and so are its `RestRefusal`s and the intake folder's `FolderError`s.
    expect(scanRefusals().judged).toEqual(
      expect.arrayContaining([
        "rest/v1-tasks.ts 'AUTOMATION_NOT_DEPLOYED'",
        "rest/v1-tasks.ts 'AUTOMATION_NOT_FOUND'",
        "rest/v1-tasks.ts 'AUTOMATION_PROJECT_FORBIDDEN'",
        "rest/v1-tasks.ts 'TASK_NOT_IN_REVIEW'",
        "domains/folders/service.ts 'FOLDER_NAME_INVALID'",
      ]),
    );
  });

  it('carry no value beyond the shared limit sentences and constants', () => {
    expect(
      scanRefusals().pieces,
      'A task refusal interpolates something new. Its sentence reaches the ' +
        'app, REST and the agent tool result: make it static (put a value ' +
        'the caller needs in the error `data`, which the agent door never ' +
        'relays) or, if it is a constant or a measured length, add it to ' +
        'ADMITTED with the reason.',
    ).toEqual(ADMITTED);
  });
});
