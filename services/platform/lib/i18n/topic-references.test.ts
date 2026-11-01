/**
 * English ships with the modules that name a topic: the `messageTopics` vite
 * plugin gives every module an import of each topic its code names
 * (`useT('tasks')`, `{ ns: 'tasks' }`, `entityNamespace: 'tasks'`, …). A
 * module that reads a namespace it computes or was handed —
 * `useT(namespace)`, `` t(`${ns}:title`) `` — names nothing, so a page that
 * reaches the topic only through it would render its keys. Each such module
 * is listed here with where its namespace is named instead.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { unnamedNamespaceReads } from '@tale/ui/vite/message-topics';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');

/** Modules that read a namespace they were handed, and where it is named. */
const HANDED: Readonly<Record<string, string>> = {
  'app/hooks/use-table-config-factory.ts':
    'its callers name `entityNamespace` and `additionalNamespaces`',
};

/**
 * Modules, by path prefix, whose `namespace` is no message topic, and what it
 * is: the plugin looks for a topic in every `…namespace` property.
 */
const OTHER_NAMESPACES: Readonly<Record<string, string>> = {
  'lib/webdav/':
    'the WebDAV area a request path names (`documents`, `.trash`); the server code there reads no message topic',
};

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), {
    recursive: true,
    withFileTypes: true,
  }).flatMap((entry) => {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(test|stories|browser\.test)\.tsx?$/.test(entry.name)) return [];
    const path = relative(ROOT, join(entry.parentPath, entry.name));
    return path.split('/').includes('tests') ? [] : [path];
  });
}

function unnamedReads(file: string): number[] {
  const code = readFileSync(join(ROOT, file), 'utf8');
  const program = parseAst(code, {
    lang: file.endsWith('.tsx') ? 'tsx' : 'ts',
  });
  return unnamedNamespaceReads(program).map(
    (offset) => code.slice(0, offset).split('\n').length,
  );
}

const SCANNED = [...sources('app'), ...sources('lib')];

function otherNamespace(file: string): boolean {
  return Object.keys(OTHER_NAMESPACES).some((prefix) =>
    file.startsWith(prefix),
  );
}

describe('message topic references', () => {
  it('reads the modules of the app and its libraries', () => {
    // A scan that found no module would pass whatever they read.
    expect(SCANNED).toEqual(
      expect.arrayContaining(['app/routes/__root.tsx', 'lib/i18n/i18n.ts']),
    );
  });

  it('name every namespace where the plugin reads it', () => {
    const unnamed = SCANNED.filter(
      (file) => HANDED[file] === undefined && !otherNamespace(file),
    ).flatMap((file) => unnamedReads(file).map((line) => `${file}:${line}`));

    expect(
      unnamed,
      "a namespace read here is computed, so its English would not ship with the module: name the topic literally (`useT('tasks')`, `{ ns: 'tasks' }`), or list the module in HANDED with where its callers name it",
    ).toEqual([]);
  });

  it('lists only modules that it reads and that still read such a namespace', () => {
    expect(
      Object.keys(HANDED).filter(
        (file) => !SCANNED.includes(file) || unnamedReads(file).length === 0,
      ),
    ).toEqual([]);
    expect(
      Object.keys(OTHER_NAMESPACES).filter(
        (prefix) =>
          !SCANNED.some(
            (file) => file.startsWith(prefix) && unnamedReads(file).length > 0,
          ),
      ),
    ).toEqual([]);
  });
});
