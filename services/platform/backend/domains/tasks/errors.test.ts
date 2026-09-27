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
 * the backend, and every `new ProjectError(…)` the task domain throws, and
 * admits a message that is a literal or is built only from what
 * {@link ADMITTED} names: the shared limit sentences
 * (`core/tasks/helpers.ts`'s `task*Refusal`, which state a cap, its unit and
 * a measured length — `helpers.test.ts` pins them), plain constants, and the
 * one reviewed exception listed there with its reason. A new piece fails
 * here until it is either made static or reviewed onto the list.
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

/** `<file> <code> <piece>` for every non-literal piece of a refusal's
 * message — a template's interpolations, or the whole expression when the
 * message is not a template at all. */
function interpolatedPieces(): string[] {
  const pieces: string[] = [];
  for (const file of sourceFiles(BACKEND)) {
    const source = readFileSync(file, 'utf8');
    if (!/new (TaskError|TaskReviewError|ProjectError)\(/.test(source)) {
      continue;
    }
    const relative = path.relative(BACKEND, file).split(path.sep).join('/');
    const inTasks = relative.startsWith('domains/tasks/');
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
          (inTasks && node.expression.text === 'ProjectError'))
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
