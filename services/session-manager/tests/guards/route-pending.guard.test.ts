// A route whose loader waits for a read (`waitForRead`) has a Suspense
// boundary of its own (`wrapInSuspense: true`) and holds a page that is still
// loading no longer than its read (`pendingMinMs: 0`). TanStack Router can
// draw a page while its loader still waits: a navigation that interrupts
// another commits the newer one's matches before they have loaded. Such a page
// suspends, and a route with no boundary of its own suspended the root's,
// which hid everything beside the page (the list of sessions, the row the
// keyboard was on) for half a second, the default `pendingMinMs`.
//
// A pending component would give the route a boundary too, but the build
// splits `component` out of the route's file: a pending component that names
// it names a function no longer in the file, and one grouped into its chunk
// kept a page whose code could not be fetched from reloading.
//
// The root route waits for a read too, but its match is the same on every
// page: only the first load ever draws it pending, before the first frame
// (`app/main.tsx`).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const ROUTES = join(ROOT, 'app', 'routes');

/** Every route file: not the tests. */
function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    const isRoute =
      /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name);
    return isRoute ? [path] : [];
  });
}

/** The options a file hands `createFileRoute(path)(…)`, if it does. */
function routeOptions(
  source: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'createFileRoute'
    ) {
      const [options] = node.arguments;
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        found = options;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function property(
  options: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const entry of options.properties) {
    if (
      ts.isPropertyAssignment(entry) &&
      ts.isIdentifier(entry.name) &&
      entry.name.text === name
    ) {
      return entry.initializer;
    }
  }
  return undefined;
}

function callsWaitForRead(node: ts.Node): boolean {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'waitForRead'
  ) {
    return true;
  }
  return ts.forEachChild(node, callsWaitForRead) ?? false;
}

/**
 * What a route that waits for a read lacks, as `file: what`, or nothing for a
 * route that does not wait. `file` only names the source in the answer.
 */
function pendingProblems(text: string, file: string): string[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const options = routeOptions(source);
  if (options === undefined) return [];
  const loader = property(options, 'loader');
  if (loader === undefined || !callsWaitForRead(loader)) return [];

  const problems: string[] = [];
  if (property(options, 'wrapInSuspense')?.getText(source) !== 'true') {
    problems.push(`${file}: it has no Suspense boundary of its own`);
  }
  if (property(options, 'pendingMinMs')?.getText(source) !== '0') {
    problems.push(`${file}: its pendingMinMs is not 0`);
  }
  if (property(options, 'pendingComponent') !== undefined) {
    problems.push(`${file}: it has a pendingComponent`);
  }
  return problems;
}

describe('a route that waits for a read', () => {
  it('suspends only itself while it waits, and no longer than its read', () => {
    const problems = routeFiles(ROUTES).flatMap((path) =>
      pendingProblems(readFileSync(path, 'utf8'), relative(ROOT, path)),
    );
    expect(problems).toEqual([]);
  });

  it('finds the routes it guards', () => {
    const waiting = routeFiles(ROUTES).filter((path) => {
      const text = readFileSync(path, 'utf8');
      return text.includes('createFileRoute') && text.includes('waitForRead(');
    });
    expect(waiting.map((path) => relative(ROUTES, path)).sort()).toEqual([
      'sessions/$sessionId.tsx',
      'settings/ai-access.tsx',
      'settings/general.tsx',
    ]);
  });

  describe('the check itself', () => {
    it('names what a waiting route lacks', () => {
      const source = `
        export const Route = createFileRoute('/things/$id')({
          loader: ({ context }) => waitForRead(context.read(), warn),
          pendingComponent: ThingPage,
          component: ThingPage,
        });
      `;
      expect(pendingProblems(source, 'thing.tsx')).toEqual([
        'thing.tsx: it has no Suspense boundary of its own',
        'thing.tsx: its pendingMinMs is not 0',
        'thing.tsx: it has a pendingComponent',
      ]);
    });

    it('passes a waiting route with a boundary of its own', () => {
      const source = `
        export const Route = createFileRoute('/things/$id')({
          loader: ({ context }) => {
            return waitForRead(context.read(), warn);
          },
          wrapInSuspense: true,
          pendingMinMs: 0,
          component: ThingPage,
        });
      `;
      expect(pendingProblems(source, 'thing.tsx')).toEqual([]);
    });

    it('leaves a route alone whose loader does not wait', () => {
      const source = `
        export const Route = createFileRoute('/things')({
          loader: ({ context }) => {
            void context.queryClient.ensureQueryData(thingsQuery());
          },
          component: ThingsPage,
        });
      `;
      expect(pendingProblems(source, 'things.tsx')).toEqual([]);
    });
  });
});
