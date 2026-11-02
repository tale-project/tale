// A write that reports its own outcome does it from its call's own promise
// (`mutateAsync(args).then(onSuccess, onError)`, or a `try`), never from the
// callbacks of `mutate(args, { onSuccess, onError })`: react-query runs those
// only while the call is the latest of its hook and the component that made it
// is still mounted. A second `mutate` on the same hook, or a dialog that closes
// first, drops them, and a failure the page meant to word (a name that is
// taken, a proxy that is in use) goes unreported. `.agents/repo.md` ("One
// failure, one toast") holds the rule for the platform; this holds it for the
// page of this service.
//
// `mutate` and `mutateAsync` take a second argument for nothing but those
// callbacks, so any second argument is a violation. The options of the hook
// itself (`useMutation({ onSuccess })`, `useApiMutation({ onSuccess })`) are
// not: they run for every call.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const APP = join(ROOT, 'app');

/** Every page source: not the tests, and not the router's generated tree. */
function pageSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageSources(path);
    const isSource =
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.gen.ts');
    return isSource ? [path] : [];
  });
}

/** The two ways to call a write. */
const WRITES = new Set(['mutate', 'mutateAsync']);

/** Names a write goes by in a file: `mutate`, `mutateAsync`, and any name one was bound to. */
function mutateNames(source: ts.SourceFile): Set<string> {
  const names = new Set(WRITES);
  const visit = (node: ts.Node): void => {
    // `const { mutate: rename } = useRename()`
    if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      WRITES.has((node.propertyName ?? node.name).getText(source))
    ) {
      names.add(node.name.text);
    }
    // `const rename = mutation.mutate`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isPropertyAccessExpression(node.initializer) &&
      WRITES.has(node.initializer.name.text)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * The calls of `text` that hand a write a second argument, as `file:line`.
 * `file` only names the source in the answer (and picks TSX or TS).
 */
function mutateCallsWithCallbacks(text: string, file: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names = mutateNames(source);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length > 1) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : undefined;
      if (name !== undefined && names.has(name)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${file}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the writes of the page', () => {
  it('report their outcome from the promise of the call, not from the callbacks of mutate or mutateAsync', () => {
    const violations = pageSources(APP).flatMap((path) =>
      mutateCallsWithCallbacks(
        readFileSync(path, 'utf8'),
        relative(ROOT, path),
      ),
    );
    expect(violations).toEqual([]);
  });

  it('finds the sources it guards', () => {
    expect(pageSources(APP).length).toBeGreaterThan(150);
  });

  describe('the check itself', () => {
    it('sees callbacks handed to mutate on a hook, on a destructured name and on a renamed one', () => {
      const source = `
        function Dialog() {
          const rename = useRename();
          const { mutate } = useCheck();
          const { mutate: remove } = useRemove();
          const add = useAdd().mutate;
          rename.mutate({ id: 1 }, { onSuccess: close });
          mutate({ id: 2 }, { onError: tell });
          remove({ id: 3 }, { onSettled: close });
          add({ id: 4 }, options);
          rename.mutateAsync({ id: 5 }, { onSuccess: close });
        }
      `;
      expect(mutateCallsWithCallbacks(source, 'dialog.tsx')).toEqual([
        'dialog.tsx:7',
        'dialog.tsx:8',
        'dialog.tsx:9',
        'dialog.tsx:10',
        'dialog.tsx:11',
      ]);
    });

    it('lets the other ways to report an outcome through', () => {
      const source = `
        function Dialog() {
          const rename = useRename();
          rename.mutate({ id: 1 });
          void rename.mutateAsync({ id: 2 }).then(close, tell);
          useMutation({ mutationFn, onSuccess: close, onError: tell });
          list.map((entry, index) => entry + index);
        }
      `;
      expect(mutateCallsWithCallbacks(source, 'dialog.tsx')).toEqual([]);
    });
  });
});
